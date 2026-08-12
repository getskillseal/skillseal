// Publisher identity, the kappa way: a key is an anchor.
//
// Every sealed skill already carries the publisher's public key. Hashing it with
// its algorithm tag yields a self-certifying anchor — a stable, portable
// identity that needs no registry and no network call. This is the kappa
// identity substrate's root primitive:
//
//   anchor = sha256(algorithm_tag || public_key_bytes)
//
// An anchor says "there is an entity that controls this key." It does not say
// who. A publisher may bind their anchor to a human readable handle they
// control; skillseal verifies that binding and reports how strong it is. We
// report structural facts and a trust level. We never decide "trusted" for you.

import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

// anchor = sha256(algorithm_tag || public_key_bytes), rendered as anchor:<hex>.
// The same bytes a kappa registry hashes, so the two compute the identical value.
export function anchorOf(publicKeyHex, algorithm = "ed25519") {
  const key = Buffer.from(publicKeyHex, "hex");
  return "anchor:" + sha256hex(Buffer.concat([Buffer.from(algorithm, "utf8"), key]));
}

// A deterministic ed25519 keypair from a seed string. Publishing without setting
// PUBLISHER_SEED uses the demo seed below, whose anchor is public and proves
// nothing about who — only that the bytes belong together.
export const DEMO_SEED = "skillseal-demo-publisher-seed";

export function keysFromSeed(seedText) {
  const seed = Buffer.from(String(seedText).slice(0, 32).padEnd(32, "!"));
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicHex = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  return { privateKey, publicHex };
}

let _demoKey = null;
const demoPublisherKey = () => (_demoKey ??= keysFromSeed(DEMO_SEED).publicHex);
export const isDemoIdentity = (publicKeyHex) => publicKeyHex === demoPublisherKey();

// Trust levels, strongest first (kappa substrate §5.3). Reported, never ranked.
export const TRUST = { CRYPTOGRAPHIC: "cryptographic", CONFIG: "config", UNSIGNED: "unsigned" };

// Verify a publisher's identity binding: does the handle they claim actually
// point back at this anchor? The publisher serves a small document at
//   https://<handle>/.well-known/skillseal.json   ->  { "anchors": ["anchor:…"] }
// and control of that domain is the proof. Returns { ok, trust, handle, detail }.
// Network is injectable for tests; any failure degrades to config (TOFU), never
// throws — a binding that cannot be checked is simply weaker, not fatal.
export async function verifyBinding(anchor, identity, opts = {}) {
  if (!identity || !identity.handle) return { ok: false, trust: TRUST.CONFIG, detail: "no binding" };
  const fetchFn = opts.fetch || globalThis.fetch;
  const handle = String(identity.handle).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const url = `https://${handle}/.well-known/skillseal.json`;
  try {
    const res = await fetchFn(url, { signal: opts.signal });
    if (!res || !res.ok) return { ok: false, trust: TRUST.CONFIG, handle, detail: `binding not served (${res && res.status})` };
    const doc = await res.json();
    const anchors = Array.isArray(doc && doc.anchors) ? doc.anchors : [];
    if (anchors.includes(anchor)) return { ok: true, trust: TRUST.CRYPTOGRAPHIC, handle, detail: url };
    return { ok: false, trust: TRUST.CONFIG, handle, detail: "handle does not list this anchor" };
  } catch {
    return { ok: false, trust: TRUST.CONFIG, handle, detail: "could not reach " + url };
  }
}
