// Remembering publishers.
//
// The first time you install from a publisher, their key is written down. From
// then on a token signed by a different key for that same name is surfaced
// rather than accepted, because a silent change of key is exactly what someone
// taking over a name would look like.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const FILE = process.env.SKILLSEAL_PUBLISHERS || join(homedir(), ".skillseal", "publishers.json");

function load() {
  if (!existsSync(FILE)) return {};
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}

function save(db) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// Returns { status: "new" | "known" | "changed", previousKey }
export function checkPublisher(name, publisherKey) {
  if (!name || !publisherKey) return { status: "new" };
  const db = load();
  const previous = db[name];
  if (!previous) return { status: "new" };
  if (previous.key === publisherKey) return { status: "known" };
  return { status: "changed", previousKey: previous.key };
}

export function rememberPublisher(name, publisherKey) {
  if (!name || !publisherKey) return;
  const db = load();
  db[name] = { key: publisherKey, firstSeen: db[name]?.firstSeen || null };
  save(db);
}

export const publishersFile = FILE;
