#!/usr/bin/env node
// skillx — install an agent skill from a token that proves what it is.
//
//   skillx add sk1…            fetch, check, and install for the agents you have
//   skillx inspect sk1…        read the token without touching the network
//   skillx publish <dir>       turn a skill folder into a token
//   skillx where               show which agents were found on this machine
//
// The token carries the skill's fingerprint, its publisher's key, and their
// signature, so nothing along the way has to be trusted.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { install } from "./install.mjs";
import { readToken, createToken, toUri } from "./token.mjs";
import { fingerprintOf } from "./fetch.mjs";
import { detect } from "./agents.mjs";
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
  if (!token) { console.error("usage: skillx add sk1…"); process.exit(2); }

  console.log(`\n${c.b}Installing a skill${c.off}\n`);
  let result;
  try {
    result = await install(token, {
      agent: flag(args, "--agent"),
      name: flag(args, "--name"),
      locations: flag(args, "--from") ? [flag(args, "--from")] : [],
      to: flag(args, "--to"),
      acceptNewKey: has(args, "--accept-new-key"),
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
    if (first) addToLock(result.name, token, first.dest);
  }
  for (const s of result.steps) ok(s);
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
  if (!tokenStr) { console.error("usage: skillx inspect sk1…"); process.exit(2); }
  let t;
  try { t = readToken(tokenStr); }
  catch (e) { console.error(`  ${c.r}✗${c.off} ${e.message}`); process.exit(1); }

  console.log(`\n${c.b}${t.name || "(unnamed skill)"}${c.off}\n`);
  info(`fingerprint  ${t.fingerprint}`);
  info(`publisher    ${t.publisherKey}`);
  info(`signature    ${t.signature ? "present" : c.y + "none" + c.off}`);
  info(`locations    ${t.locations.length ? t.locations.join(", ") : "none listed"}`);
  info(`contents     ${t.inline ? `travels with the token (${t.inline.length} bytes)` : "fetched on install"}`);
  console.log(`\n  ${c.dim}Checked offline. Nothing was fetched.${c.off}\n`);
}

// ── publish ──────────────────────────────────────────────────────────────
// The generated file list is not part of the skill, so it never counts itself.
const GENERATED = new Set([".skill-files.json"]);

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir).sort()) {
    if (GENERATED.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push({ path: relative(base, p).split(sep).join("/"), full: p });
  }
  return out;
}

function keysFromSeed(seedText) {
  const seed = Buffer.from(String(seedText).slice(0, 32).padEnd(32, "!"));
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicHex: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex") };
}

async function cmdPublish(args) {
  const dir = args.find((a) => !a.startsWith("-") && a !== "publish");
  if (!dir || !existsSync(join(dir, "SKILL.md"))) {
    console.error("usage: skillx publish <skill-dir> [--from <url>] [--upload] [--inline]");
    process.exit(2);
  }
  const files = walk(dir).map((f) => {
    const bytes = readFileSync(f.full);
    return { path: f.path, bytes, address: fingerprintOf(bytes), size: bytes.length };
  });
  const nameFromMd = /^\s*name:\s*(.+)$/m.exec(readFileSync(join(dir, "SKILL.md"), "utf8"))?.[1]?.trim();
  const name = flag(args, "--name", nameFromMd || basename(dir));

  const inlineOnly = has(args, "--inline") && files.length === 1;
  const { privateKey, publicHex } = keysFromSeed(process.env.PUBLISHER_SEED || "skillx-demo-publisher-seed");

  // With --upload, put every file in the configured store first and note the
  // IPFS address it comes back with. Those go into the file list, so anyone can
  // later fetch the same bytes through any public gateway.
  const extraLocations = [];
  if (has(args, "--upload")) {
    const s3 = await import("../lib/s3.mjs");
    for (const f of files) {
      await s3.s3Put(f.address, f.bytes);
      f.cid = await s3.s3Cid(f.address).catch(() => null);
    }
    const withCid = files.filter((f) => f.cid).length;
    info(`uploaded ${files.length} file(s)${withCid ? `, ${withCid} with an IPFS address` : ""}`);
  }

  let fingerprint, listBytes = null;
  if (inlineOnly) {
    fingerprint = files[0].address;
  } else {
    // Keys in a fixed order so the same skill always yields the same fingerprint.
    listBytes = Buffer.from(JSON.stringify({
      files: files.map((f) => ({
        address: f.address, ...(f.cid ? { cid: f.cid } : {}), path: f.path, size: f.size,
      })),
      kind: "agent-skill",
      name,
    }), "utf8");
    fingerprint = fingerprintOf(listBytes);

    if (has(args, "--upload")) {
      const s3 = await import("../lib/s3.mjs");
      await s3.s3Put(fingerprint, listBytes);
      const listCid = await s3.s3Cid(fingerprint).catch(() => null);
      if (listCid) {
        extraLocations.push(`ipfs://${listCid}`);
        info(`file list on IPFS: ${listCid}`);
      }
    }
  }

  const signature = edSign(null, Buffer.from(fingerprint), privateKey).toString("hex");
  const locations = [...args.filter((a, i) => args[i - 1] === "--from"), ...extraLocations];

  const token = createToken({
    fingerprint, publisherKey: publicHex, signature, name, locations,
    inline: inlineOnly ? files[0].bytes : null,
  });

  if (listBytes) {
    writeFileSync(join(dir, ".skill-files.json"), listBytes);
    info(`wrote ${join(dir, ".skill-files.json")} — upload it and every file under its own fingerprint`);
  }
  console.log(`\n${c.b}${name}${c.off}\n`);
  info(`fingerprint  ${fingerprint}`);
  info(`publisher    ${publicHex}`);
  console.log(`\n${c.b}Anyone can install it with:${c.off}\n`);
  console.log(`  npx skillx add ${token}\n`);
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
${c.b}Checking ${names.length} pinned skill(s)${c.off}
`);
  let bad = 0;
  for (const name of names) {
    const { token, installedTo } = lock.skills[name];
    const r = verifyInstalled(installedTo, token);
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
function cmdWhere() {
  console.log(`\n${c.b}Agents on this machine${c.off}\n`);
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
  where: () => cmdWhere(),
}[cmd];

if (!run) {
  console.log(`
${c.b}skillx${c.off} — install an agent skill from a token that proves what it is

  ${c.b}skillx add${c.off} sk1…          fetch, check, and install it
  ${c.b}skillx inspect${c.off} sk1…      read the token, offline
  ${c.b}skillx publish${c.off} <dir>     turn a skill folder into a token
  ${c.b}skillx verify${c.off}            re-check every skill in skills.lock
  ${c.b}skillx where${c.off}             show the agents found here

Options: --agent <id>  --all  --from <url>  --to <dir>  --name <n>  --force  --accept-new-key
`);
  process.exit(cmd ? 2 : 0);
}
await run();
