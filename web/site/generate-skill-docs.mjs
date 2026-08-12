// Generate a Docusaurus docs page for every skill.
//
// Mirrors the upstream route shape:
//   /docs/user-guide/skills/bundled/{category}/{category}-{name}
//
// Each page carries the skill's identity as content: its address, its Filecoin
// CID, and the per-file table from the Merkle manifest, followed by the full
// SKILL.md reference. The address on the page is computed here, so the docs and
// the thing an agent fetches cannot drift apart.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTree } from "../../demo/lib/skilltree.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SKILLS_ROOT = process.env.SKILLS_ROOT || join(REPO_ROOT, "skills-ref");
const OUT = join(HERE, "docs", "user-guide", "skills", "bundled");

const fm = (md, k) => (new RegExp(`^\\s*${k}:\\s*(.+)$`, "m").exec(md)?.[1] || "").trim();
const list = (md, k) => (new RegExp(`${k}:\\s*\\[(.*?)\\]`, "s").exec(md)?.[1] || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function findSkills(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const category of readdirSync(root)) {
    const catDir = join(root, category);
    if (!statSync(catDir).isDirectory()) continue;
    for (const name of readdirSync(catDir)) {
      const dir = join(catDir, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, "SKILL.md"))) out.push({ category, name, dir });
    }
  }
  return out;
}

const title = (s) => s.split(/[-_]/).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function page(skill) {
  const md = readFileSync(join(skill.dir, "SKILL.md"), "utf8");
  const tree = buildTree(skill.dir);
  const body = md.replace(/^---[\s\S]*?---\s*/, "").trim();

  const name = fm(md, "name") || skill.name;
  const files = tree.manifest.files
    .map((f) => `| \`${f.path}\` | \`${f.address}\` | ${f.size} |`).join("\n");

  return `---
title: ${title(name)}
description: ${fm(md, "description") || ""}
---

# ${title(name)}

${fm(md, "description") || ""}

## Skill metadata

| | |
| --- | --- |
| Name | \`${name}\` |
| Version | ${fm(md, "version") || "1.0.0"} |
| Author | ${fm(md, "author") || "community"} |
| Category | ${skill.category} |
| Tags | ${list(md, "tags").map((t) => `\`${t}\``).join(", ") || "—"} |

## Verification

This skill is addressed by the hash of its contents. An agent fetches it by
that address and rechecks every file before running anything, so a changed
skill is a different address it was never approved to use.

| | |
| --- | --- |
| Address | \`${tree.address}\` |
| Files | ${tree.manifest.files.length} |

\`\`\`bash
# fetch from distributed storage, verify, and use it
node agent/skill-agent.mjs --address ${tree.address} --key <publisher-key>
\`\`\`

### Files

| Path | Address | Bytes |
| --- | --- | --- |
${files}

## Reference: full SKILL.md

${body}
`;
}

// The hub pages have one source of truth under hub/. Copy them into the site on
// every build so a fresh clone serves them at /hub/ without a manual step.
function copyHub() {
  const dest = join(HERE, "static", "hub");
  mkdirSync(dest, { recursive: true });
  for (const page of ["index.html", "seal.html", "ipfs.html", "skill.html", "catalog.json"]) {
    const src = join(REPO_ROOT, "web", "hub", page);
    if (!existsSync(src)) continue;
    writeFileSync(join(dest, page), readFileSync(src));
    console.log(`copied hub/${page} -> static/hub/${page}`);
  }
  // the content-addressed blob store, so a pasted v2 pointer resolves straight
  // from Pages with no setup (the address is still hashed on arrival).
  const blobs = join(REPO_ROOT, "web", "hub", "blobs");
  if (existsSync(blobs)) { cpSync(blobs, join(dest, "blobs"), { recursive: true }); console.log("copied hub/blobs -> static/hub/blobs"); }
}

function main() {
  copyHub();
  rmSync(OUT, { recursive: true, force: true });
  const skills = findSkills(SKILLS_ROOT);
  const cats = new Set();

  for (const s of skills) {
    const dir = join(OUT, s.category);
    mkdirSync(dir, { recursive: true });
    if (!cats.has(s.category)) {
      writeFileSync(join(dir, "_category_.json"),
        JSON.stringify({ label: title(s.category), collapsible: true, collapsed: true }, null, 2));
      cats.add(s.category);
    }
    // Upstream file naming: {category}-{name}
    writeFileSync(join(dir, `${s.category}-${s.name}.md`), page(s));
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "_category_.json"),
    JSON.stringify({ label: "Bundled", collapsible: true, collapsed: false }, null, 2));
  writeFileSync(join(OUT, "index.md"), `---
title: Bundled Skills
sidebar_position: 0
---

# Bundled skills

Every skill below is content addressed: the page shows the address an agent
fetches, and the per-file table it verifies against.

${skills.map((s) => `- [${title(s.name)}](./${s.category}/${s.category}-${s.name}.md)`).join("\n")}
`);

  console.log(`generated ${skills.length} skill page(s) under docs/user-guide/skills/bundled:`);
  for (const s of skills) console.log(`  /docs/user-guide/skills/bundled/${s.category}/${s.category}-${s.name}`);
}

main();
