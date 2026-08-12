// Build a content-addressed Merkle manifest for a skill DIRECTORY.
// Shared by the skill-tree CLI and the storage-substrate act.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, sep } from "node:path";
import { contentAddress, canonicalJson } from "./store.mjs";

export function walk(dir, base = dir, acc = []) {
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

// Returns {manifest, bytes, address, files:[{path,address,size,bytes}]}.
export function buildTree(dir) {
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
