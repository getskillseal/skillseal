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

// Docs live on the same platform the upstream hub uses (Docusaurus), at the
// same route shape: /docs/user-guide/skills/bundled/{category}/{category}-{name}
const DOCS_BASE = process.env.HUB_DOCS_BASE || "/skillseal";

function frontmatter(dir) {
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  const get = (k) => (new RegExp(`^\\s*${k}:\\s*(.+)$`, "m").exec(md)?.[1] || "").trim();
  const list = (k) => (new RegExp(`${k}:\\s*\\[(.*?)\\]`, "s").exec(md)?.[1] || "")
    .split(",").map((t) => t.trim()).filter(Boolean);

  // First paragraph under the first heading becomes the overview; the
  // "When to Use" section is the most useful summary when present.
  const body = md.replace(/^---[\s\S]*?---\s*/, "");
  const when = /##\s*When to Use\s*\n+([\s\S]*?)(?:\n##|$)/i.exec(body)?.[1];
  const overview = (when || body.replace(/^#[^\n]*\n+/, "").split(/\n\s*\n/)[0] || "")
    .trim().replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\s+/g, " ");

  return {
    description: get("description"),
    author: get("author") || "community",
    version: get("version") || "1.0.0",
    license: get("license") || "MIT",
    tags: list("tags"),
    platforms: list("platforms"),
    prereqCmds: list("requires_toolsets"),
    overview,
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
      source: "official",
      author: fm.author,
      category: f.category,
      desc: fm.description,
      overview: fm.overview,
      tags: fm.tags,
      platforms: fm.platforms,
      prereq: fm.prereqCmds[0] ? { kind: "cmd", value: fm.prereqCmds[0] } : null,
      version: fm.version,
      license: fm.license,
      address: tree.address,
      cid: cid || "(not pinned yet)",
      files: tree.manifest.files.length,
      docs: `${DOCS_BASE}/docs/user-guide/skills/bundled/${f.category}/${f.category}-${f.name}`,
    });
  }

  writeFileSync("hub/catalog.json", JSON.stringify({ generated: true, skills }, null, 2));
  console.log(`wrote hub/catalog.json with ${skills.length} skill(s):`);
  for (const s of skills) console.log(`  ${s.name.padEnd(16)} ${s.address.slice(0, 26)}...  ${s.files} files`);
}

main().catch((e) => { console.error(e); process.exit(1); });
