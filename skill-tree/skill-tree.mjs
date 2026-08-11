// skill-tree -- content-address a whole Hermes-style skill DIRECTORY.
//
// A Hermes skill is not a single file. It is a directory tree:
//   category/skill-name/
//     SKILL.md            (required)
//     scripts/ references/ templates/ examples/ assets/   (optional)
//
// Hermes tracks skills by comparing local file hashes to an "origin hash"
// recorded at last sync, and gates installs with policy scanning. There is no
// cryptographic signing. This encoder gives a skill a single, verifiable
// identity and a signed provenance:
//
//   1. every file  -> its own content address (a blob in the store)
//   2. a MANIFEST listing {path -> address, size}, sorted, canonical JSON
//   3. the manifest's own address IS the skill's identity (a Merkle root over
//      the tree: change any byte of any file and the skill address changes)
//   4. a LOCAL pin records the approved skill address (root of trust)
//   5. the store's ed25519 signed namespace root covers the pin, so a
//      publisher's skill set is cryptographically attestable, not just hash-
//      compared against an unauthenticated origin.
//
// Usage:
//   node skill-tree/skill-tree.mjs encode <skill-dir> [pin-name]
//   node skill-tree/skill-tree.mjs verify <skill-dir> [pin-name]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, sep } from "node:path";
import {
  putBlob, getBlob, setPin, contentAddress, canonicalJson, NAMESPACE,
} from "../lib/store.mjs";
import { savePin, loadPin } from "../lib/pins.mjs";

function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, acc);
    else acc.push({ path: relative(base, full).split(sep).join("/"), full, size: st.size });
  }
  return acc;
}

function skillName(dir) {
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  const name = /^name:\s*(.+)$/m.exec(md)?.[1]?.trim();
  const version = /^version:\s*(.+)$/m.exec(md)?.[1]?.trim() || "0";
  return { name: name || basename(dir), version };
}

// Build the Merkle manifest for a skill directory. Returns {manifest, bytes,
// address, files:[{path,address,size,bytes}]}.
function buildTree(dir) {
  const { name, version } = skillName(dir);
  const files = walk(dir).map((f) => {
    const bytes = readFileSync(f.full);
    return { path: f.path, address: contentAddress(bytes), size: f.size, bytes };
  });
  const manifest = {
    kind: "hermes-skill",
    name,
    version,
    files: files.map((f) => ({ path: f.path, address: f.address, size: f.size })),
  };
  const bytes = Buffer.from(canonicalJson(manifest), "utf8");
  return { manifest, bytes, address: contentAddress(bytes), files };
}

async function encode(dir, pinArg) {
  const tree = buildTree(dir);
  const pin = pinArg || `skill.${tree.manifest.name}`;

  // Local approval is authoritative (root of trust).
  savePin(NAMESPACE, pin, { address: tree.address, approvedAt: new Date().toISOString(), manifest: tree.manifest });

  // Publish every file blob + the manifest, and pin in the store for the
  // signed audit root. Best effort; the local pin stands regardless.
  try {
    for (const f of tree.files) await putBlob(f.bytes);
    await putBlob(tree.bytes);
    await setPin(pin, tree.address);
  } catch (e) {
    console.log(`[encode] store publish skipped (${e.message}); local pin still authoritative`);
  }

  console.log(`[encode] "${tree.manifest.name}" v${tree.manifest.version}`);
  console.log(`[encode] skill address : ${tree.address}`);
  console.log(`[encode] ${tree.files.length} file(s):`);
  for (const f of tree.files) console.log(`  ${f.address.slice(0, 19)}...  ${f.path} (${f.size}B)`);
  console.log(`[encode] pinned "${pin}" (local root of trust)`);
  return 0;
}

async function verify(dir, pinArg) {
  const tree = buildTree(dir);
  const pin = pinArg || `skill.${tree.manifest.name}`;
  const approved = loadPin(NAMESPACE, pin);
  if (!approved) {
    console.log(`[verify] no local approval for "${pin}". Encode it first.`);
    return 3;
  }
  if (approved.address !== tree.address) {
    // Identify which file(s) changed by comparing per-file addresses.
    const was = new Map((approved.manifest.files || []).map((f) => [f.path, f.address]));
    const now = new Map(tree.manifest.files.map((f) => [f.path, f.address]));
    const changed = [];
    for (const [p, a] of now) if (was.get(p) !== a) changed.push(was.has(p) ? `~ ${p}` : `+ ${p}`);
    for (const p of was.keys()) if (!now.has(p)) changed.push(`- ${p}`);
    console.log("");
    console.log(`  SKILL TREE CHANGED for "${pin}"`);
    console.log(`  approved: ${approved.address}`);
    console.log(`  current : ${tree.address}`);
    console.log(`  files:\n    ${changed.join("\n    ")}`);
    console.log("\n[verify] skill changed since approval. Refused.");
    return 1;
  }
  console.log(`[verify] "${pin}" verified -> ${tree.address}. All ${tree.files.length} files match. Safe to activate.`);
  return 0;
}

// Prove the store can be an untrusted substrate: fetch every file from the
// store by address and re-verify it hashes to that address. Any backend
// (S3, IPFS, Filecoin) is acceptable because the address is the proof.
async function audit(dir, pinArg) {
  const tree = buildTree(dir);
  const pin = pinArg || `skill.${tree.manifest.name}`;
  let ok = 0, bad = 0;
  const manifestBytes = await getBlob(tree.address);
  if (!manifestBytes || contentAddress(manifestBytes) !== tree.address) {
    console.log("[audit] manifest missing or mismatched in store"); return 1;
  }
  const manifest = JSON.parse(manifestBytes.toString());
  for (const f of manifest.files) {
    const b = await getBlob(f.address);
    if (b && contentAddress(b) === f.address) ok++;
    else { bad++; console.log(`  MISMATCH ${f.path}`); }
  }
  console.log(`[audit] re-verified from store: ${ok} ok, ${bad} bad. Backend is untrusted; addresses are the proof.`);
  return bad === 0 ? 0 : 1;
}

async function main() {
  const [cmd, dir, pinArg] = process.argv.slice(2);
  if (!cmd || !dir) {
    console.log("usage: skill-tree.mjs <encode|verify|audit> <skill-dir> [pin-name]");
    process.exit(2);
  }
  const fn = { encode, verify, audit }[cmd];
  if (!fn) { console.log(`unknown command: ${cmd}`); process.exit(2); }
  process.exit(await fn(dir, pinArg));
}
main().catch((e) => { console.error(e); process.exit(1); });
