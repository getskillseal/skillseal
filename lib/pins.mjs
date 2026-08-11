// The local, out-of-band root of trust.
//
// Approval is recorded HERE, on the verifier's own disk, not in the shared
// store. This is the fix for the central weakness of a naive design: if the
// expected address is fetched from the store on every check, then anyone who
// can write to the store controls what "approved" means. By keeping the
// approved manifest and the store's signing key local, an attacker who can
// reach the store cannot alter an approval.
//
// Each pin file holds the full approved manifest bytes (so drift can be diffed
// with no store dependency), the content address, and the store public key
// captured at approval time (so the signed-root audit can pin the key).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "pins");

function pinPath(namespace, name) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(ROOT, namespace, `${safe}.json`);
}

export function savePin(namespace, name, record) {
  const p = pinPath(namespace, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(record, null, 2));
  return p;
}

export function loadPin(namespace, name) {
  const p = pinPath(namespace, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

// The store's signing key, pinned out-of-band at first approval. Trust-on-
// first-use: the first approval records the key; later audits require the
// signed root to carry exactly this key.
function keyPath(namespace) {
  return join(ROOT, namespace, ".storekey");
}

export function saveStoreKey(namespace, keyHex) {
  const p = keyPath(namespace);
  mkdirSync(dirname(p), { recursive: true });
  if (!existsSync(p)) writeFileSync(p, keyHex); // pin once; do not silently rotate
}

export function loadStoreKey(namespace) {
  const p = keyPath(namespace);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
}
