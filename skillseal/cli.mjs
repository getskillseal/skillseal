#!/usr/bin/env node
// skillseal 🦭 — install an agent skill from a token that proves what it is.
//
// Two kinds of seal, one idea: a wax seal shows a letter was not opened and
// who sent it. This does the same for a skill.
//
//   skillseal add sk1…            fetch, check, and install for the agents you have
//   skillseal inspect sk1…        read the token without touching the network
//   skillseal publish <dir>       turn a skill folder into a token
//   skillseal where               show which agents were found on this machine
//
// The token carries the skill's fingerprint, its publisher's key, and their
// signature, so nothing along the way has to be trusted.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { sign as edSign } from "node:crypto";
import { install } from "./install.mjs";
import { readToken, createToken, createPointer, toUri } from "./token.mjs";
import { buildManifest, publisherHint, resolveManifest } from "./manifest.mjs";
import { fingerprintOf, urlsFor } from "./fetch.mjs";
import { detect } from "./agents.mjs";
import { allPublishers } from "./publishers.mjs";
import { anchorOf, keysFromSeed, isDemoIdentity, DEMO_SEED } from "./identity.mjs";
import { readLock, addToLock, verifyInstalled, LOCKFILE } from "./lock.mjs";

const c = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", off: "\x1b[0m" };
const ok = (s) => console.log(`  ${c.g}✓${c.off} ${s}`);
const info = (s) => console.log(`  ${c.dim}${s}${c.off}`);

function flag(args, name, def = null) {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
}
const has = (args, name) => args.includes(name);

// ── add ──────────────────────────────────────────────────────────────────
async function cmdAdd(args) {
  const token = args.find((a) => a.startsWith("sk1") || a.startsWith("skill://"));
  if (!token) { console.error("usage: skillseal add sk1…"); process.exit(2); }

  console.log(`\n${c.b}🦭 Installing a skill${c.off}\n`);
  let result;
  try {
    result = await install(token, {
      agent: flag(args, "--agent"),
      name: flag(args, "--name"),
      locations: flag(args, "--from") ? [flag(args, "--from")] : [],
      to: flag(args, "--to"),
      acceptNewKey: has(args, "--accept-new-key"),
      allowUnsigned: has(args, "--allow-unsigned"),
      force: has(args, "--force"),
      all: has(args, "--all"),
    });
  } catch (e) {
    console.error(`  ${c.r}✗ refused${c.off}  ${e.message}`);
    console.error(`\n  Nothing was written.\n`);
    process.exit(1);
  }

  if (!has(args, "--no-lock")) {
    const first = result.installed.find((t) => !t.skipped);
    if (first) addToLock(result.name, token, first.dest, result.entries);
  }
  for (const s of result.steps) ok(s);
  const tcolor = result.trust === "cryptographic" ? c.g : c.y;
  console.log(`\n  identity: ${tcolor}${result.trust}${c.off} ${c.dim}(${result.trust === "cryptographic" ? "a domain proved control of this key" : result.trust === "config" ? "trusted on first use — same key as last time, but not tied to a name" : "no signature — publisher unproven"})${c.off}`);
  for (const w of result.warnings || []) console.log(`  ${c.y}⚠ ${w}${c.off}`);
  console.log("");
  for (const t of result.installed) {
    if (t.skipped) info(`${t.label}: ${t.skipped} (use --force to replace)`);
    else console.log(`  ${c.g}installed${c.off} ${c.b}${result.name}${c.off} → ${t.label}\n            ${c.dim}${t.dest}${c.off}`);
  }
  console.log(`\n  ${c.dim}Your agent will pick it up next time it starts.${c.off}\n`);
}

// ── inspect ──────────────────────────────────────────────────────────────
function cmdInspect(args) {
  const tokenStr = args.find((a) => a.startsWith("sk1") || a.startsWith("skill://"));
  if (!tokenStr) { console.error("usage: skillseal inspect sk1…"); process.exit(2); }
  let t;
  try { t = readToken(tokenStr); }
  catch (e) { console.error(`  ${c.r}✗${c.off} ${e.message}`); process.exit(1); }

  if (t.version === 2) {
    console.log(`\n${c.b}pointer token (v2)${c.off}\n`);
    info(`manifest     ${t.manifestAddress}`);
    if (t.publisherHint) {
      // Recognize the publisher offline: does the 4-byte hint match a key we pinned?
      const match = Object.entries(allPublishers()).find(([, key]) => publisherHint(key) === t.publisherHint);
      info(`publisher    hint ${t.publisherHint}${match ? ` — ${c.g}a key you have pinned: ${match[0]}${c.off}` : c.dim + " (not among your pinned publishers)" + c.off}`);
    } else {
      info(`publisher    in the manifest`);
    }
    console.log(`\n  ${c.dim}On install: fetch the manifest by this address, check its hash,${c.off}`);
    console.log(`  ${c.dim}then its signature, then every file. Nothing was fetched now.${c.off}\n`);
    return;
  }

  console.log(`\n${c.b}${t.name || "(unnamed skill)"}${c.off}\n`);
  info(`fingerprint  ${t.fingerprint}`);
  info(`publisher    ${t.publisherKey}`);
  info(`anchor       ${anchorOf(t.publisherKey)}`);
  info(`signature    ${t.signature ? "present" : c.y + "none" + c.off}`);
  info(`locations    ${t.locations.length ? t.locations.join(", ") : "none listed"}`);
  info(`contents     ${t.inline ? `travels with the token (${t.inline.length} bytes)` : "fetched on install"}`);
  console.log(`\n  ${c.dim}Checked offline. Nothing was fetched.${c.off}\n`);
}

// ── publish ──────────────────────────────────────────────────────────────
// The generated file list is not part of the skill, so it never counts itself.
const GENERATED = new Set([".skill-files.json", ".skill-manifest.json"]);

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir).sort()) {
    if (GENERATED.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push({ path: relative(base, p).split(sep).join("/"), full: p });
  }
  return out;
}

async function cmdPublish(args) {
  const dir = args.find((a) => !a.startsWith("-") && a !== "publish");
  if (!dir || !existsSync(join(dir, "SKILL.md"))) {
    console.error("usage: skillseal publish <skill-dir> [--from <url>] [--upload] [--bind <handle>] [--inline] [--v1]");
    process.exit(2);
  }
  const files = walk(dir).map((f) => {
    const bytes = readFileSync(f.full);
    return { path: f.path, bytes, address: fingerprintOf(bytes), size: bytes.length };
  });
  const nameFromMd = /^\s*name:\s*(.+)$/m.exec(readFileSync(join(dir, "SKILL.md"), "utf8"))?.[1]?.trim();
  const name = flag(args, "--name", nameFromMd || basename(dir));

  const inlineOnly = has(args, "--inline") && files.length === 1;
  const seed = process.env.PUBLISHER_SEED || DEMO_SEED;
  const { privateKey, publicHex } = keysFromSeed(seed);
  const identity = flag(args, "--bind") ? { handle: flag(args, "--bind"), method: "well-known" } : null;
  if (seed === DEMO_SEED) {
    info(`${c.y}⚠ sealing under the shared demo identity — proves integrity, not who.${c.off}`);
    info(`${c.y}  set PUBLISHER_SEED to seal under your own key.${c.off}`);
  }

  // With --upload, put every file in the configured store first and note the
  // IPFS address it comes back with. Those go into the file list, so anyone can
  // later fetch the same bytes through any public gateway.
  const extraLocations = [];
  if (has(args, "--upload")) {
    const store = await import("./store.mjs");
    for (const f of files) {
      await store.put(f.address, f.bytes);
      f.cid = await store.ipfsAddress(f.address).catch(() => null);
    }
    const withCid = files.filter((f) => f.cid).length;
    info(`uploaded ${files.length} file(s)${withCid ? `, ${withCid} with an IPFS address` : ""}`);
  }

  const fromLocations = args.filter((a, i) => args[i - 1] === "--from");

  // ── a one-file skill can travel inside the token itself (always the full form) ──
  if (inlineOnly) {
    const fingerprint = files[0].address;
    const signature = edSign(null, Buffer.from(fingerprint), privateKey).toString("hex");
    const token = createToken({ fingerprint, publisherKey: publicHex, signature, name, locations: fromLocations, inline: files[0].bytes });
    return printPublished({ name, idLabel: "fingerprint", id: fingerprint, publicHex, token });
  }

  // ── the full v1 token: fingerprint + key + signature + file list, all inline ──
  if (has(args, "--v1")) {
    const listBytes = Buffer.from(JSON.stringify({
      files: files.map((f) => ({ address: f.address, ...(f.cid ? { cid: f.cid } : {}), path: f.path, size: f.size })),
      kind: "agent-skill",
      name,
    }), "utf8");
    const fingerprint = fingerprintOf(listBytes);
    if (has(args, "--upload")) {
      const store = await import("./store.mjs");
      await store.put(fingerprint, listBytes);
      const listCid = await store.ipfsAddress(fingerprint).catch(() => null);
      if (listCid) { extraLocations.push(`ipfs://${listCid}`); info(`file list on IPFS: ${listCid}`); }
    }
    const signature = edSign(null, Buffer.from(fingerprint), privateKey).toString("hex");
    const token = createToken({ fingerprint, publisherKey: publicHex, signature, name, locations: [...fromLocations, ...extraLocations] });
    writeFileSync(join(dir, ".skill-files.json"), listBytes);
    info(`wrote ${join(dir, ".skill-files.json")} — upload it and every file under its own fingerprint`);
    return printPublished({ name, idLabel: "fingerprint", id: fingerprint, publicHex, token });
  }

  // ── the v2 pointer (default): the line is one address of a signed manifest ──
  const { manifestBytes, address } = buildManifest({
    name, publisherKey: publicHex, privateKey, identity,
    files: files.map((f) => ({ address: f.address, cid: f.cid, path: f.path, size: f.size })),
    locations: fromLocations,
  });
  if (has(args, "--upload")) {
    const store = await import("./store.mjs");
    await store.put(address, manifestBytes);
    const manCid = await store.ipfsAddress(address).catch(() => null);
    info(`manifest uploaded${manCid ? ` (ipfs ${manCid})` : ""}`);
  }
  writeFileSync(join(dir, ".skill-manifest.json"), manifestBytes);
  info(`wrote ${join(dir, ".skill-manifest.json")} — upload it and every file under its own address`);
  const hint = has(args, "--no-hint") ? null : publisherHint(publicHex);
  const token = createPointer({ manifestAddress: address, hint });
  return printPublished({ name, idLabel: "manifest", id: address, publicHex, token, hint, identity });
}

function printPublished({ name, idLabel, id, publicHex, token, hint, identity }) {
  console.log(`\n${c.b}${name}${c.off}\n`);
  info(`${idLabel.padEnd(11)}  ${id}`);
  info(`publisher    ${publicHex}${hint ? `  ${c.dim}(hint ${hint})${c.off}` : ""}`);
  info(`anchor       ${anchorOf(publicHex)}`);
  if (identity && identity.handle) {
    info(`identity     ${identity.handle}  ${c.dim}(serve /.well-known/skillseal.json listing this anchor to make it verifiable)${c.off}`);
  }
  info(`length       ${token.length} chars`);
  console.log(`\n${c.b}Anyone can install it with:${c.off}\n`);
  console.log(`  npx skillseal add ${token}\n`);
  console.log(`${c.dim}link form:${c.off} ${toUri(token)}\n`);
}

// ── verify ───────────────────────────────────────────────────────────────
function cmdVerify() {
  const lock = readLock();
  const names = Object.keys(lock.skills);
  if (!names.length) { console.log(`
  nothing pinned in ${LOCKFILE}
`); return; }
  console.log(`
${c.b}🦭 Checking ${names.length} pinned skill(s)${c.off}
`);
  let bad = 0;
  for (const name of names) {
    const { token, installedTo, files } = lock.skills[name];
    const r = verifyInstalled(installedTo, token, files || null);
    if (r.ok) ok(`${name}`);
    else { bad++; console.log(`  ${c.r}✗${c.off} ${name} — ${r.reason}`); }
  }
  console.log("");
  if (bad) { console.log(`  ${c.r}${bad} of ${names.length} no longer match what was pinned.${c.off}
`); process.exit(1); }
  console.log(`  ${c.dim}All installed skills still match their tokens.${c.off}
`);
}

// ── where ────────────────────────────────────────────────────────────────
// ── sources ────────────────────────────────────────────────────────────────
// The swarm, from the terminal: every place this skill can be fetched from, and
// which ones answer with the right bytes right now. Like a torrent's peer list,
// but every "peer" is checked against the content hash, so a green tick is proof.
const DEFAULT_STORES = (process.env.SKILLSEAL_STORES || "https://getskillseal.github.io/skillseal/hub")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

async function ping(url, want) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { ok: false };
    const b = Buffer.from(await r.arrayBuffer());
    return { ok: fingerprintOf(b) === want, ms: Date.now() - t0 };
  } catch { return { ok: false }; }
  finally { clearTimeout(timer); }
}

async function reportArtifact(label, address, locations) {
  const urls = [...new Set(locations.flatMap((loc) => urlsFor(loc, address)))];
  console.log(`\n  ${c.b}${label}${c.off}  ${c.dim}${address}${c.off}`);
  if (!urls.length) { console.log(`    ${c.dim}no sources listed${c.off}`); return; }
  const results = await Promise.all(urls.map(async (u) => ({ u, ...await ping(u, address) })));
  let up = 0;
  for (const { u, ok: good, ms } of results) {
    if (good) { up++; console.log(`    ${c.g}✓${c.off} ${hostOf(u).padEnd(28)} ${c.dim}${ms}ms${c.off}`); }
    else console.log(`    ${c.dim}·  ${hostOf(u).padEnd(28)} no answer${c.off}`);
  }
  console.log(`    ${up ? c.g : c.y}served by ${up}/${urls.length} independent source(s)${c.off}`);
}

async function cmdSources(args) {
  const tokenStr = args.find((a) => a.startsWith("sk1") || a.startsWith("skill://"));
  if (!tokenStr) { console.error("usage: skillseal sources sk1…"); process.exit(2); }
  let t; try { t = readToken(tokenStr); } catch (e) { console.error(`  ${c.r}✗${c.off} ${e.message}`); process.exit(1); }
  const stores = [...(flag(args, "--from") ? [flag(args, "--from")] : []), ...DEFAULT_STORES];

  console.log(`\n${c.b}🦭 Sources for this skill${c.off}`);
  console.log(`  ${c.dim}The name is the content hash. Any host with the bytes can serve it; each${c.off}`);
  console.log(`  ${c.dim}answer is rehashed against that name, so no source has to be trusted.${c.off}`);

  if (t.version === 2) {
    await reportArtifact("manifest", t.manifestAddress, stores);
    const resolved = await resolveManifest(t.manifestAddress, stores).catch(() => null);
    if (resolved) for (const f of resolved.files) {
      await reportArtifact(f.path, f.address, [...(f.cid ? [`ipfs://${f.cid}`] : []), ...resolved.locations, ...stores]);
    } else console.log(`\n  ${c.y}could not resolve the manifest to list its files (try --from <store>)${c.off}`);
  } else {
    await reportArtifact("file list", t.fingerprint, [...t.locations, ...stores]);
    console.log(`\n  ${c.dim}v1 token — per-file sources appear once the list is fetched on install.${c.off}`);
  }
  console.log(`\n  ${c.dim}Remove any one source and the rest still resolve. That is the point.${c.off}\n`);
}

function cmdWhere() {
  console.log(`\n${c.b}🦭 Agents on this machine${c.off}\n`);
  for (const a of detect()) {
    console.log(`  ${a.present ? c.g + "found  " + c.off : c.dim + "absent " + c.off} ${a.label.padEnd(30)} ${c.dim}${a.dir}${c.off}`);
  }
  console.log(`\n  ${c.dim}A skill installs as a plain folder, so anything above reads it as-is.${c.off}\n`);
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  add: () => cmdAdd(args),
  install: () => cmdAdd(args),
  inspect: () => cmdInspect(args),
  publish: () => cmdPublish(args),
  verify: () => cmdVerify(),
  sources: () => cmdSources(args),
  where: () => cmdWhere(),
}[cmd];

if (!run) {
  console.log(`
${c.b}🦭 skillseal${c.off} — install an agent skill from a token that proves what it is

  ${c.b}skillseal add${c.off} sk1…          fetch, check, and install it
  ${c.b}skillseal inspect${c.off} sk1…      read the token, offline
  ${c.b}skillseal publish${c.off} <dir>     turn a skill folder into a token
  ${c.b}skillseal verify${c.off}            re-check every skill in skills.lock
  ${c.b}skillseal sources${c.off} sk1…      list every place it can be fetched from, live
  ${c.b}skillseal where${c.off}             show the agents found here

A token comes in two shapes, same guarantee: a short v2 pointer (~60 chars,
the address of a signed manifest) or the full v1 form. ${c.b}add${c.off} accepts either.
${c.b}publish${c.off} emits v2 by default; --v1 for the full form, --no-hint to drop the
publisher hint. A v2 pointer resolves through --from <store> or SKILLSEAL_STORES.

Identity: a publisher key is an anchor, sha256(algo, key). ${c.b}publish --bind <handle>${c.off}
claims a domain; serving /.well-known/skillseal.json listing the anchor makes it
verifiable, and ${c.b}add${c.off} reports the trust level (cryptographic / config / unsigned).
Unsigned tokens are refused unless you pass --allow-unsigned.

Options: --agent <id>  --all  --from <url>  --to <dir>  --name <n>  --bind <handle>
         --force  --accept-new-key  --allow-unsigned
`);
  process.exit(cmd ? 2 : 0);
}
await run();
