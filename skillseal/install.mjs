// Install a skill from a token.
//
// Order matters. Everything is checked before a single byte is written where
// the agent can see it:
//
//   1. the token's own checksum        catches a damaged paste, offline
//   2a. v2: the manifest matches its address, then its signature
//   2b. v1: the publisher's signature over the fingerprint
//   3. the file list matches its id    the index has not been swapped
//   4. every file matches its entry    no file has been altered
//   5. only then, move it into place   in one step, so a failure leaves nothing
//
// Both token shapes converge on the same plan — a name, a publisher key, and a
// list of files each named by its own address — and share the tail below.
// Nothing is executed during any of this. Installing a skill never runs it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { readToken } from "./token.mjs";
import { verifyManifest, resolveManifest } from "./manifest.mjs";
import { fetchByFingerprint, fingerprintOf } from "./fetch.mjs";
import { targets, ensure } from "./agents.mjs";
import { checkPublisher, rememberPublisher } from "./publishers.mjs";
import { anchorOf, isDemoIdentity, verifyBinding, TRUST } from "./identity.mjs";

// Default content stores for resolving a v2 pointer, which carries no location
// of its own. Any store that lays files out by their address works; none is
// trusted, because whatever it returns is hashed against the address first.
// A default public mirror so a pasted pointer resolves with no setup. It is not
// trusted: whatever it returns is hashed against the address first, so it can
// only fail to answer, never answer with something else. Override or add your
// own with SKILLSEAL_STORES or --from.
const DEFAULT_STORES = (process.env.SKILLSEAL_STORES || "https://getskillseal.github.io/skillseal/hub")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

function signatureValid(message, signatureHex, publicKeyHex) {
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(publicKeyHex, "hex"),
  ]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return edVerify(null, Buffer.from(message), key, Buffer.from(signatureHex, "hex"));
}

// A file list entry must stay inside the skill folder.
function safeJoin(root, relPath) {
  const full = resolve(root, relPath);
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`unsafe path in skill: ${relPath}`);
  return full;
}

// v2: resolve the pointer to a verified manifest, then a plan.
async function planFromPointer(token, opts, steps) {
  const stores = [...(opts.locations || []), ...DEFAULT_STORES];
  if (!stores.length) {
    throw new Error(
      "a pointer token needs a content store to resolve its manifest; " +
      "pass --from <store-url> or set SKILLSEAL_STORES",
    );
  }
  const resolved = await resolveManifest(token.manifestAddress, stores);
  if (!resolved) throw new Error("could not fetch the manifest from any store (try --from <store-url>)");
  steps.push("manifest matches the address in the token");
  steps.push(`signed by ${resolved.publisherKey.slice(0, 16)}…`);
  return {
    name: resolved.name,
    publisherKey: resolved.publisherKey,
    signed: true,
    identity: resolved.identity || null,
    entries: resolved.files,
    // a file may name its own IPFS spot; the manifest's own hints and the stores follow.
    locations: [...resolved.locations, ...stores],
    inlineFiles: null,
  };
}

// v1: the full token carries everything; check its signature, then read its
// list (or its inline body).
async function planFromLegacy(token, opts, steps) {
  if (token.signature) {
    if (!signatureValid(token.fingerprint, token.signature, token.publisherKey)) {
      throw new Error("the publisher's signature does not match this skill");
    }
    steps.push(`signed by ${token.publisherKey.slice(0, 16)}…`);
  } else if (opts.allowUnsigned) {
    steps.push("unsigned publisher, accepted with --allow-unsigned");
  } else {
    throw new Error("this token is unsigned, so its publisher is unproven. Re-run with --allow-unsigned to install anyway.");
  }
  const signed = !!token.signature;

  if (token.inline) {
    if (fingerprintOf(token.inline) !== token.fingerprint) throw new Error("inline contents do not match the token");
    steps.push("contents came with the token, no download needed");
    return {
      name: token.name,
      publisherKey: token.publisherKey,
      signed, identity: null,
      entries: [{ path: "SKILL.md", address: token.fingerprint }],
      locations: [],
      inlineFiles: [{ path: "SKILL.md", bytes: token.inline }],
    };
  }

  const locations = [...token.locations, ...(opts.locations || [])];
  if (!locations.length) throw new Error("this token lists nowhere to fetch from; pass --from <url>");
  const listBytes = await fetchByFingerprint(token.fingerprint, locations);
  if (!listBytes) throw new Error("could not fetch this skill from any of the listed places");
  if (fingerprintOf(listBytes) !== token.fingerprint) throw new Error("the file list does not match the token");
  steps.push("file list matches the token");
  const list = JSON.parse(listBytes.toString());
  return {
    name: token.name || list.name,
    publisherKey: token.publisherKey,
    signed, identity: null,
    entries: list.files,
    locations,
    inlineFiles: null,
  };
}

export async function install(tokenString, opts = {}) {
  const steps = [];
  const token = readToken(tokenString);           // 1. checksum verified here
  steps.push("token checksum is valid");

  const plan = token.version === 2
    ? await planFromPointer(token, opts, steps)
    : await planFromLegacy(token, opts, steps);

  // A publisher you have installed from before must still be the same one.
  const seen = checkPublisher(plan.name, plan.publisherKey);
  if (seen.status === "changed" && !opts.acceptNewKey) {
    throw new Error(
      `"${plan.name}" was published before by a different key ` +
      `(${seen.previousKey.slice(0, 16)}… , now ${plan.publisherKey.slice(0, 16)}…). ` +
      `If you expected this, re-run with --accept-new-key.`,
    );
  }
  if (seen.status === "known") steps.push("same publisher as last time");
  if (seen.status === "changed") steps.push("publisher key changed and was accepted explicitly");

  // Publisher identity: a key is an anchor. Report who, and how strongly.
  const anchor = anchorOf(plan.publisherKey);
  const warnings = [];
  let trust = plan.signed ? TRUST.CONFIG : TRUST.UNSIGNED;
  steps.push(`publisher ${anchor.slice(0, 27)}…`);
  if (isDemoIdentity(plan.publisherKey)) {
    warnings.push("sealed by the shared demo identity — it proves the bytes belong together, not who made them (set PUBLISHER_SEED to seal under your own key)");
  }
  if (plan.identity && plan.identity.handle) {
    const bind = await verifyBinding(anchor, plan.identity, { fetch: opts.fetch });
    if (bind.ok) { trust = TRUST.CRYPTOGRAPHIC; steps.push(`identity verified: ${bind.handle} controls this key`); }
    else { steps.push(`identity claim "${plan.identity.handle}" not verified (${bind.detail}); treated as unverified`); }
  }

  // Resolve the files: either they travelled inline, or fetch each by address.
  let files, entries;
  if (plan.inlineFiles) {
    files = plan.inlineFiles;
    entries = plan.entries;
  } else {
    files = [];
    entries = [];
    for (const entry of plan.entries) {
      const where = entry.cid ? [`ipfs://${entry.cid}`, ...plan.locations] : plan.locations;
      const bytes = await fetchByFingerprint(entry.address, where);
      if (!bytes) throw new Error(`missing file: ${entry.path}`);
      if (fingerprintOf(bytes) !== entry.address) throw new Error(`altered file: ${entry.path}`);
      files.push({ path: entry.path, bytes });
      entries.push({ path: entry.path, address: entry.address });
    }
    steps.push(`all ${files.length} files match their entries`);
  }

  const name = opts.name || plan.name || (token.manifestAddress || token.fingerprint).slice(7, 19);

  // Build the folder somewhere temporary, then move it into place in one step.
  const staging = mkdtempSync(join(tmpdir(), "skillseal-"));
  const built = join(staging, name);
  mkdirSync(built, { recursive: true });
  for (const f of files) {
    const dest = safeJoin(built, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.bytes);
  }
  if (!existsSync(join(built, "SKILL.md"))) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error("this is not an Agent Skill: no SKILL.md");
  }

  const installed = [];
  for (const target of targets({ only: opts.agent, all: opts.all, to: opts.to })) {
    ensure(target.dir);
    const dest = join(target.dir, name);
    if (existsSync(dest)) {
      if (!opts.force) { installed.push({ ...target, dest, skipped: "already installed" }); continue; }
      rmSync(dest, { recursive: true, force: true });
    }
    // Copy per target so one failure cannot leave another half-written.
    mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const out = safeJoin(dest, f.path);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.bytes);
    }
    installed.push({ ...target, dest });
  }
  rmSync(staging, { recursive: true, force: true });
  rememberPublisher(plan.name, plan.publisherKey);

  return { name, token, steps, files: files.length, entries, installed, anchor, trust, warnings, identity: plan.identity || null };
}

// Check an already installed skill still matches what it was installed from.
// If the verified file list is supplied (from the lockfile), re-hash each file
// on disk against it — works offline for both token shapes.
export function checkInstalled(dir, token, expectedFiles = null) {
  const skill = join(dir, "SKILL.md");
  if (!existsSync(skill)) return { ok: false, reason: "no SKILL.md" };
  if (expectedFiles && expectedFiles.length) {
    for (const { path, address } of expectedFiles) {
      const full = join(dir, path);
      if (!existsSync(full)) return { ok: false, reason: `missing ${path}` };
      if (fingerprintOf(readFileSync(full)) !== address) return { ok: false, reason: `${path} changed since install` };
    }
    return { ok: true };
  }
  const t = readToken(token);
  if (t.inline) return { ok: fingerprintOf(readFileSync(skill)) === t.fingerprint, reason: "contents" };
  return { ok: true, reason: "listed files not re-checked without the file list" };
}
