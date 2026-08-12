// Generate hub/catalog.json from real, encoded skills.
//
// Walks a skills root (Hermes layout: category/skill-name/SKILL.md), encodes
// each skill into its Merkle manifest, and records the REAL content address for
// every entry. If the skill's blobs are also present in the object store, the
// Filecoin/IPFS CID is fetched and recorded as provenance.
//
//   node hub/build-catalog.mjs [skills-root]
//
// The hub page loads catalog.json when present and falls back to its embedded
// sample set otherwise.

import { readdirSync, statSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTree } from "../lib/skilltree.mjs";

const ROOT = process.argv[2] || "skills-samples";

function frontmatter(dir) {
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  const get = (k) => (new RegExp(`^${k}:\\s*(.+)$`, "m").exec(md)?.[1] || "").trim();
  const tagLine = /tags:\s*\[(.*?)\]/s.exec(md)?.[1] || "";
  return {
    description: get("description"),
    author: get("author") || "community",
    tags: tagLine.split(",").map((t) => t.trim()).filter(Boolean),
  };
}

function findSkills(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const category of readdirSync(root)) {
    const catDir = join(root, category);
    if (!statSync(catDir).isDirectory()) continue;
    for (const name of readdirSync(catDir)) {
      const dir = join(catDir, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, "SKILL.md"))) {
        out.push({ category, name, dir });
      }
    }
  }
  return out;
}

async function main() {
  const found = findSkills(ROOT);
  let s3Cid = null;
  try { ({ s3Cid } = await import("../lib/s3.mjs")); } catch { /* store optional */ }

  const skills = [];
  for (const f of found) {
    const tree = buildTree(f.dir);
    const fm = frontmatter(f.dir);
    let cid = null;
    if (s3Cid) { try { cid = await s3Cid(tree.address); } catch { cid = null; } }
    skills.push({
      name: tree.manifest.name,
      author: fm.author,
      category: f.category,
      desc: fm.description,
      tags: fm.tags,
      address: tree.address,
      cid: cid || "(not pinned yet)",
      files: tree.manifest.files.length,
      installs: 0,
    });
  }

  writeFileSync("hub/catalog.json", JSON.stringify({ generated: true, skills }, null, 2));
  console.log(`wrote hub/catalog.json with ${skills.length} skill(s):`);
  for (const s of skills) console.log(`  ${s.name.padEnd(16)} ${s.address.slice(0, 26)}...  ${s.files} files`);
}

main().catch((e) => { console.error(e); process.exit(1); });
