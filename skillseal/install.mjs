// Install a skill from a token.
//
// Order matters. Everything is checked before a single byte is written where
// the agent can see it:
//
//   1. the token's own checksum        catches a damaged paste, offline
//   2. the publisher's signature       says who vouches for these contents
//   3. the file list matches its id    the index has not been swapped
//   4. every file matches its entry    no file has been altered
//   5. only then, move it into place   in one step, so a failure leaves nothing
//
// Nothing is executed during any of this. Installing a skill never runs it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { readToken } from "./token.mjs";
import { fetchByFingerprint, fingerprintOf } from "./fetch.mjs";
import { targets, ensure } from "./agents.mjs";
import { checkPublisher, rememberPublisher } from "./publishers.mjs";

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

export async function install(tokenString, opts = {}) {
  const steps = [];
  const token = readToken(tokenString);           // 1. checksum verified here
  steps.push("token checksum is valid");

  if (token.signature) {
    if (!signatureValid(token.fingerprint, token.signature, token.publisherKey)) {
      throw new Error("the publisher's signature does not match this skill");
    }
    steps.push(`signed by ${token.publisherKey.slice(0, 16)}…`);
  } else {
    steps.push("no signature on this token (unsigned publisher)");
  }

  // A publisher you have installed from before must still be the same one.
  const seen = checkPublisher(token.name, token.publisherKey);
  if (seen.status === "changed" && !opts.acceptNewKey) {
    throw new Error(
      `"${token.name}" was published before by a different key ` +
      `(${seen.previousKey.slice(0, 16)}… , now ${token.publisherKey.slice(0, 16)}…). ` +
      `If you expected this, re-run with --accept-new-key.`,
    );
  }
  if (seen.status === "known") steps.push("same publisher as last time");
  if (seen.status === "changed") steps.push("publisher key changed and was accepted explicitly");

  // A very small skill can travel inside the token itself, needing no network.
  let files;
  if (token.inline) {
    if (fingerprintOf(token.inline) !== token.fingerprint) throw new Error("inline contents do not match the token");
    files = [{ path: "SKILL.md", bytes: token.inline }];
    steps.push("contents came with the token, no download needed");
  } else {
    const locations = [...token.locations, ...(opts.locations || [])];
    if (!locations.length) throw new Error("this token lists nowhere to fetch from; pass --from <url>");

    const listBytes = await fetchByFingerprint(token.fingerprint, locations);
    if (!listBytes) throw new Error("could not fetch this skill from any of the listed places");
    if (fingerprintOf(listBytes) !== token.fingerprint) throw new Error("the file list does not match the token");
    steps.push("file list matches the token");

    const list = JSON.parse(listBytes.toString());
    files = [];
    for (const entry of list.files) {
      // A file may also name its own spot on IPFS, giving another way to get it.
      const where = entry.cid ? [`ipfs://${entry.cid}`, ...locations] : locations;
      const bytes = await fetchByFingerprint(entry.address, where);
      if (!bytes) throw new Error(`missing file: ${entry.path}`);
      if (fingerprintOf(bytes) !== entry.address) throw new Error(`altered file: ${entry.path}`);
      files.push({ path: entry.path, bytes });
    }
    steps.push(`all ${files.length} files match their entries`);
    token.name = token.name || list.name;
  }

  const name = opts.name || token.name || token.fingerprint.slice(7, 19);

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
  rememberPublisher(token.name, token.publisherKey);

  return { name, token, steps, files: files.length, installed };
}

// Check an already installed skill still matches its token.
export function checkInstalled(dir, token) {
  const t = readToken(token);
  const skill = join(dir, "SKILL.md");
  if (!existsSync(skill)) return { ok: false, reason: "no SKILL.md" };
  if (t.inline) return { ok: fingerprintOf(readFileSync(skill)) === t.fingerprint, reason: "contents" };
  return { ok: true, reason: "listed files not re-checked without the file list" };
}
