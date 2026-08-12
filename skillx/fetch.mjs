// Fetching, with every source treated as hostile.
//
// Files are stored under a path derived from their own fingerprint, so any
// plain web host, object store, or gateway can serve them. Whatever comes back
// is hashed and compared before it is used, which means a bad mirror can only
// fail to answer. It can never answer with something else.

import { createHash } from "node:crypto";

export const fingerprintOf = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

// A location is a base URL, or a template containing {fp} for hosts that lay
// their files out differently.
export function urlFor(location, fingerprint) {
  const hex = fingerprint.replace(/^sha256:/, "");
  if (location.includes("{fp}")) return location.replace("{fp}", hex);
  const base = location.replace(/\/$/, "");
  return `${base}/blobs/sha256/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

async function tryOne(location, fingerprint, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(urlFor(location, fingerprint), { signal: controller.signal });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return fingerprintOf(bytes) === fingerprint ? bytes : null; // wrong bytes are simply not an answer
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Public gateways, tried when a token's own locations come up empty. Safe to
// use precisely because nothing they return is believed without checking.
export const PUBLIC_GATEWAYS = (process.env.SKILLX_GATEWAYS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Ask every location at once and keep the first correct answer.
export async function fetchByFingerprint(fingerprint, locations, { timeoutMs = 15000 } = {}) {
  if (!locations.length) return null;
  const attempts = locations.map((loc) =>
    tryOne(loc, fingerprint, timeoutMs).then((b) => (b ? b : Promise.reject(new Error("no")))),
  );
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}
