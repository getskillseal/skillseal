// Tier A pin harness: encode a whole skills catalogue, pin it, and sign it.
//
// Walks one or more skill roots in the Hermes layout, encodes every skill
// directory into its Merkle manifest, records the approved address locally,
// optionally publishes every blob to distributed S3-compatible storage
// (Filecoin via Akave or Filebase), and emits ONE signed registry root: a
// manifest of manifests covering the whole catalogue.
//
// A subscriber then needs exactly two things to trust the entire hub: the
// registry root address and the publisher's public key.
//
//   node harness/pin-hub.mjs --root <dir>:<source> [--root ...] [--publish]
//
// Example against a checkout of the upstream agent repo:
//   node harness/pin-hub.mjs \
//     --root /path/hermes-agent/skills:builtin \
//     --root /path/hermes-agent/optional-skills:official --publish

import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname, relative, sep } from "node:path";
import { createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { contentAddress, canonicalJson, NAMESPACE } from "../lib/store.mjs";
import { buildTree } from "../lib/skilltree.mjs";
import { savePin } from "../lib/pins.mjs";
import { createToken } from "../../skillseal/token.mjs";

const OUT = "harness/out";

function parseArgs(argv) {
  const roots = [];
  let publish = false, limit = Infinity;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      const [dir, source = "community"] = argv[++i].split(/:(?=[^:]*$)/);
      roots.push({ dir, source });
    }
    if (argv[i] === "--publish") publish = true;
    if (argv[i] === "--limit") limit = Number(argv[++i]);
  }
  return { roots, publish, limit };
}

// Find every skill directory: any directory containing a SKILL.md.
function findSkills(root, source) {
  const found = [];
  if (!existsSync(root)) return found;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    if (entries.includes("SKILL.md")) {
      const rel = relative(root, dir).split(sep);
      found.push({
        dir,
        name: basename(dir),
        category: rel.length > 1 ? rel[0] : "general",
        source,
      });
      return; // do not descend into a skill's own subdirectories
    }
    for (const e of entries) {
      const p = join(dir, e);
      try { if (statSync(p).isDirectory()) walk(p); } catch { /* unreadable */ }
    }
  };
  walk(root);
  return found;
}

function publisherKeys() {
  const seed = Buffer.from(
    (process.env.PUBLISHER_SEED || "pin-the-protocol-demo-publisher-seed!!").slice(0, 32).padEnd(32, "!"),
  );
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicHex: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex"),
  };
}

const fm = (md, k) => (new RegExp(`^\\s*${k}:\\s*(.+)$`, "m").exec(md)?.[1] || "").trim();
const fmList = (md, k) => (new RegExp(`${k}:\\s*\\[(.*?)\\]`, "s").exec(md)?.[1] || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  const { roots, publish, limit } = parseArgs(process.argv.slice(2));
  if (!roots.length) {
    console.error("usage: pin-hub.mjs --root <dir>:<source> [--root ...] [--publish] [--limit N]");
    process.exit(2);
  }

  let s3 = null;
  if (publish) {
    try { s3 = await import("../lib/s3.mjs"); } catch { console.error("storage unavailable"); }
  }

  const all = roots.flatMap((r) => findSkills(r.dir, r.source)).slice(0, limit);
  console.log(`found ${all.length} skill(s) across ${roots.length} root(s)\n`);

  const entries = [], catalog = [];
  let bytes = 0, files = 0, objects = 0, skipped = 0;
  const seen = new Set(); // dedup identical blobs across skills

  for (const s of all) {
    let tree;
    try { tree = buildTree(s.dir); } catch { skipped++; continue; }
    const md = readFileSync(join(s.dir, "SKILL.md"), "utf8");

    files += tree.manifest.files.length;
    bytes += tree.manifest.files.reduce((n, f) => n + f.size, 0);

    let listCid = null;
    if (s3) {
      for (const f of tree.files) {
        if (seen.has(f.address)) continue;      // content addressing dedups for free
        seen.add(f.address);
        await s3.s3Put(f.address, f.bytes);
        objects++;
      }
      if (!seen.has(tree.address)) { seen.add(tree.address); await s3.s3Put(tree.address, tree.bytes); objects++; }
      // The address the store gives back, so the skill can also be fetched
      // through any public gateway.
      listCid = await s3.s3Cid(tree.address).catch(() => null);
    }

    savePin(NAMESPACE, `skill.${s.category}.${s.name}`, {
      address: tree.address, approvedAt: null, manifest: tree.manifest,
    });

    entries.push({ name: s.name, category: s.category, source: s.source, address: tree.address, files: tree.manifest.files.length });
    catalog.push({
      name: fm(md, "name") || s.name,
      source: s.source,
      category: s.category,
      desc: fm(md, "description") || "",
      tags: fmList(md, "tags"),
      platforms: fmList(md, "platforms"),
      version: fm(md, "version") || "1.0.0",
      author: fm(md, "author") || "community",
      license: fm(md, "license") || "MIT",
      address: tree.address,
      cid: listCid || "(not pinned yet)",
      ipfs: listCid,
      docs: `/skillseal/docs/user-guide/skills/bundled/${s.category}/${s.category}-${s.name}`,
    });
  }

  // The registry root: one canonical, sorted statement over the whole catalogue.
  entries.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
  const root = { kind: "skill-registry-root", count: entries.length, skills: entries };
  const rootBytes = Buffer.from(canonicalJson(root), "utf8");
  const rootAddress = contentAddress(rootBytes);

  const { privateKey, publicHex } = publisherKeys();

  // Give every catalogue entry a one-line install token, so the hub hands out
  // something that proves itself rather than a name to be looked up.
  const base = process.env.HUB_LOCATION ? [process.env.HUB_LOCATION] : [];
  for (let i = 0; i < catalog.length; i++) {
    const fp = catalog[i].address;
    const gateway = catalog[i].ipfs ? ["ipfs://" + catalog[i].ipfs] : [];
    catalog[i].token = createToken({
      fingerprint: fp,
      publisherKey: publicHex,
      signature: edSign(null, Buffer.from(fp), privateKey).toString("hex"),
      name: catalog[i].name,
      locations: [...base, ...gateway],
    });
    delete catalog[i].ipfs;
  }

  const signed = {
    registryRoot: rootAddress,
    count: entries.length,
    algorithm: "ed25519",
    publisherKey: publicHex,
    signature: edSign(null, Buffer.from(rootAddress), privateKey).toString("hex"),
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "registry.json"), rootBytes);
  writeFileSync(join(OUT, "registry-root.json"), JSON.stringify(signed, null, 2));
  mkdirSync("hub", { recursive: true });
  writeFileSync("hub/catalog.json", JSON.stringify({ generated: true, skills: catalog }, null, 2));
  if (s3) await s3.s3Put(rootAddress, rootBytes);

  const bySource = {};
  entries.forEach((e) => { bySource[e.source] = (bySource[e.source] || 0) + 1; });
  const cats = new Set(entries.map((e) => e.category));

  console.log(`pinned      ${entries.length} skills, ${files} files, ${(bytes / 1048576).toFixed(1)} MiB`);
  console.log(`by source   ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`categories  ${cats.size}`);
  if (skipped) console.log(`skipped     ${skipped} unreadable`);
  if (s3) console.log(`published   ${objects} objects (deduplicated by content address)`);
  console.log(`\nregistry root ${rootAddress}`);
  console.log(`signed by     ${publicHex.slice(0, 16)}…`);
  console.log(`\nwrote ${OUT}/registry.json, ${OUT}/registry-root.json, hub/catalog.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
