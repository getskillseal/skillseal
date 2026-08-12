// Fetching, with every source treated as hostile.
//
// Files are stored under a path derived from their own fingerprint, so any
// plain web host, object store, or gateway can serve them. Whatever comes back
// is hashed and compared before it is used, which means a bad mirror can only
// fail to answer. It can never answer with something else.

import { createHash } from "node:crypto";

export const fingerprintOf = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

// Public gateways used to turn an ipfs:// location into ordinary URLs. They
// need no account and are safe to use here because nothing they return is
// believed without being hashed first.
export const GATEWAYS = (process.env.SKILLX_GATEWAYS ||
  "https://ipfs.io/ipfs,https://dweb.link/ipfs,https://ipfs.filebase.io/ipfs,https://cloudflare-ipfs.com/ipfs"
).split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

// A location is one of:
//   ipfs://<cid>        fetched through any public gateway
//   https://host/{fp}   a template, for hosts with their own layout
//   https://host/base   a bucket or web root laid out by fingerprint
// Returns every URL worth trying for this location.
export function urlsFor(location, fingerprint) {
  if (location.startsWith("ipfs://")) {
    const cid = location.slice("ipfs://".length);
    return GATEWAYS.map((g) => `${g}/${cid}`);
  }
  const hex = fingerprint.replace(/^sha256:/, "");
  if (location.includes("{fp}")) return [location.replace("{fp}", hex)];
  const base = location.replace(/\/$/, "");
  return [`${base}/blobs/sha256/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`];
}

async function tryUrl(url, fingerprint, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return fingerprintOf(bytes) === fingerprint ? bytes : null; // wrong bytes are simply not an answer
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Ask everywhere at once and keep the first correct answer. One slow or
// hostile source cannot hold up the others.
export async function fetchByFingerprint(fingerprint, locations, { timeoutMs = 15000 } = {}) {
  const urls = locations.flatMap((loc) => urlsFor(loc, fingerprint));
  if (!urls.length) return null;
  const attempts = urls.map((u) =>
    tryUrl(u, fingerprint, timeoutMs).then((b) => (b ? b : Promise.reject(new Error("no")))),
  );
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}
