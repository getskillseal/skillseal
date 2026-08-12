// The signed manifest that a v2 pointer token addresses.
//
// A v2 token is nothing but the content address of one of these. Everything the
// old token spelled out inline — publisher key, signature, file list, storage
// hints — lives here instead, and the address commits to all of it. Fetch the
// manifest by that address from anywhere, check its hash, and you have verified
// the whole thing at once. No security is traded for the shorter line: the hash
// is the proof.
//
// Shape:
//   { core: { v, name, publisherKey, files, locations, kind }, sig }
//
// The signature covers the canonical bytes of `core` alone. The address covers
// the whole object, signature included, so a reader who has the address knows
// they got exactly the core the publisher signed, under exactly this signature.

import { createHash, sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";
import { fetchByFingerprint } from "./fetch.mjs";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const addressOf = (bytes) => "sha256:" + sha256hex(bytes);

// Keys in a fixed order, so the same skill always yields the same core bytes,
// the same signature input, and the same address. `JSON.stringify` emits keys
// in insertion order and `JSON.parse` preserves it, so a verifier re-serializing
// the parsed core reproduces these exact bytes.
function coreObject({ name, publisherKey, files, locations = [] }) {
  return {
    v: 2,
    name,
    publisherKey,
    files: files.map((f) => ({
      address: f.address,
      ...(f.cid ? { cid: f.cid } : {}),
      path: f.path,
      size: f.size,
    })),
    locations,
    kind: "agent-skill",
  };
}

const coreBytesOf = (core) => Buffer.from(JSON.stringify(core), "utf8");

function publicKeyFromRaw(hex) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

export const signatureValid = (coreBytes, sigHex, publicKeyHex) =>
  edVerify(null, coreBytes, publicKeyFromRaw(publicKeyHex), Buffer.from(sigHex, "hex"));

// A 4-byte tag over the publisher's key. Short enough to ride in the token,
// enough to recognize a key you have pinned before, offline.
export const publisherHint = (publicKeyHex) => sha256hex(Buffer.from(publicKeyHex, "hex")).slice(0, 8);

// Build and sign a manifest. Returns the bytes to store and the address to put
// in the token.
export function buildManifest({ name, publisherKey, privateKey, files, locations = [] }) {
  const core = coreObject({ name, publisherKey, files, locations });
  const coreBytes = coreBytesOf(core);
  const sig = edSign(null, coreBytes, privateKey).toString("hex");
  const manifestBytes = Buffer.from(JSON.stringify({ core, sig }), "utf8");
  return { manifestBytes, address: addressOf(manifestBytes), core, sig };
}

// Check manifest bytes against the address a token carried, then the signature
// inside them. Returns the verified skill descriptor, or throws. Order is the
// point: the hash is checked before the signature is read, so the key that
// signs is itself pinned by the address.
export function verifyManifest(manifestBytes, expectedAddress) {
  if (addressOf(manifestBytes) !== expectedAddress) {
    throw new Error("the manifest does not match the address in the token");
  }
  let m;
  try { m = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw new Error("the manifest is not valid JSON"); }
  if (!m || typeof m !== "object" || !m.core || typeof m.sig !== "string") {
    throw new Error("the manifest is missing its core or signature");
  }
  const core = m.core;
  if (core.v !== 2) throw new Error(`unsupported manifest version ${core.v}`);
  if (!core.publisherKey || !Array.isArray(core.files)) throw new Error("the manifest is malformed");
  if (!signatureValid(coreBytesOf(core), m.sig, core.publisherKey)) {
    throw new Error("the publisher's signature does not match the manifest");
  }
  return {
    name: core.name,
    publisherKey: core.publisherKey,
    files: core.files,
    locations: Array.isArray(core.locations) ? core.locations : [],
  };
}

// Fetch a manifest by address from any of the given stores and verify it.
// Returns null if nowhere had it; throws if what came back did not verify.
export async function resolveManifest(address, locations, opts = {}) {
  const bytes = await fetchByFingerprint(address, locations, opts);
  if (!bytes) return null;
  return { manifestBytes: bytes, ...verifyManifest(bytes, address) };
}
