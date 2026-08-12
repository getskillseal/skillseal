// skills.lock — the skills a project depends on, pinned.
//
// A line per skill: its name and the exact token it was installed from. Commit
// it and the whole team, and CI, install the same bytes. `skillx verify` reads
// it back and fails if anything on disk no longer matches.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readToken } from "./token.mjs";
import { fingerprintOf } from "./fetch.mjs";

export const LOCKFILE = process.env.SKILLX_LOCKFILE || "skills.lock";

export function readLock(file = LOCKFILE) {
  if (!existsSync(file)) return { version: 1, skills: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

export function addToLock(name, token, dir, file = LOCKFILE) {
  const lock = readLock(file);
  lock.skills[name] = { token, installedTo: dir };
  writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
  return lock;
}

// Recompute the file list from what is on disk and compare it to the token.
// This is the check that catches a skill edited after it was installed.
export function verifyInstalled(dir, tokenString) {
  const token = readToken(tokenString);
  if (!existsSync(join(dir, "SKILL.md"))) return { ok: false, reason: "missing SKILL.md" };

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
