// skills.lock — the skills a project depends on, pinned.
//
// A line per skill: its name and the exact token it was installed from. Commit
// it and the whole team, and CI, install the same bytes. `skillseal verify` reads
// it back and fails if anything on disk no longer matches.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readToken } from "./token.mjs";
import { fingerprintOf } from "./fetch.mjs";

export const LOCKFILE = process.env.SKILLSEAL_LOCKFILE || "skills.lock";

export function readLock(file = LOCKFILE) {
  if (!existsSync(file)) return { version: 1, skills: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

export function addToLock(name, token, dir, files = null, file = LOCKFILE) {
  const lock = readLock(file);
  lock.skills[name] = { token, installedTo: dir, ...(files ? { files } : {}) };
  writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
  return lock;
}

// Recompute what is on disk and compare it to what was installed. If the
// verified file list is on record (the lockfile keeps it), re-hash each file
// against it — this is offline and works for both token shapes. Otherwise fall
// back to recomputing a v1 file-list fingerprint.
export function verifyInstalled(dir, tokenString, expectedFiles = null) {
  const token = readToken(tokenString);
  if (!existsSync(join(dir, "SKILL.md"))) return { ok: false, reason: "missing SKILL.md" };

  if (expectedFiles && expectedFiles.length) {
    for (const { path, address } of expectedFiles) {
      const full = join(dir, path);
      if (!existsSync(full)) return { ok: false, reason: `missing ${path}` };
      if (fingerprintOf(readFileSync(full)) !== address) {
        return { ok: false, reason: `${path} has been edited since install` };
      }
    }
    return { ok: true };
  }

  if (token.version === 2) {
    return { ok: true, reason: "pinned by manifest address; re-run add to re-check against the network" };
  }

  if (token.inline) {
    const actual = fingerprintOf(readFileSync(join(dir, "SKILL.md")));
    return actual === token.fingerprint
      ? { ok: true }
      : { ok: false, reason: "SKILL.md has been edited since install" };
  }

  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else files.push({ path: relative(dir, p).split(sep).join("/"), full: p });
    }
  };
  walk(dir);

  const listBytes = Buffer.from(JSON.stringify({
    files: files.map((f) => {
      const bytes = readFileSync(f.full);
      return { address: fingerprintOf(bytes), path: f.path, size: bytes.length };
    }),
    kind: "agent-skill",
    name: token.name,
  }), "utf8");

  return fingerprintOf(listBytes) === token.fingerprint
    ? { ok: true }
    : { ok: false, reason: "the installed files no longer match the token" };
}
