// The install token.
//
// A skill is normally installed by name, which means trusting whoever controls
// that name. This token carries the proof instead:
//
//   what to fetch   the fingerprint of the skill's contents
//   who made it     the publisher's public key
//   proof they did  their signature over that fingerprint
//   where to look   optional locations, all of them untrusted
//
// Because the fingerprint decides what is acceptable, the places listed are
// only suggestions. A hostile mirror can fail to answer; it cannot answer with
// something else. That is what lets the token be pasted anywhere and fetched
// from anything.

import { encode as b32encode, decode as b32decode } from "./bech32.mjs";

const PREFIX = "sk";
const VERSION = 1;
const F_NAME = 1, F_LOCATIONS = 2, F_INLINE = 4, F_SIGNED = 8;

const hexToBytes = (hex) => Buffer.from(hex, "hex");
const bytesToHex = (b) => Buffer.from(b).toString("hex");

// `fingerprint` and `publisherKey` are hex. `signature` is hex or null.
// `locations` are base URLs. `inline` is optional raw bytes of a one-file skill.
export function createToken({ fingerprint, publisherKey, signature, name, locations = [], inline = null }) {
  const digest = hexToBytes(fingerprint.replace(/^sha256:/, ""));
  if (digest.length !== 32) throw new Error("fingerprint must be 32 bytes");
  const key = hexToBytes(publisherKey);
  if (key.length !== 32) throw new Error("publisher key must be 32 bytes");

  let flags = 0;
  if (name) flags |= F_NAME;
  if (locations.length) flags |= F_LOCATIONS;
  if (inline) flags |= F_INLINE;
  if (signature) flags |= F_SIGNED;

  const parts = [Buffer.from([VERSION, flags]), digest, key];
  if (signature) parts.push(hexToBytes(signature));
  if (name) {
    const n = Buffer.from(name, "utf8");
    parts.push(Buffer.from([n.length]), n);
  }
  if (locations.length) {
    parts.push(Buffer.from([locations.length]));
    for (const loc of locations) {
      const l = Buffer.from(loc, "utf8");
      parts.push(Buffer.from([l.length]), l);
    }
  }
  if (inline) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(inline.length);
    parts.push(len, Buffer.from(inline));
  }
  return b32encode(PREFIX, Buffer.concat(parts));
}

export function readToken(token) {
  const trimmed = String(token).trim().replace(/^skill:\/\//, "");
  const { hrp, bytes } = b32decode(trimmed);
  if (hrp !== PREFIX) throw new Error(`not a skill token (prefix "${hrp}")`);

  let o = 0;
  const take = (n) => { const b = bytes.subarray(o, o + n); o += n; return b; };
  const version = take(1)[0];
  if (version !== VERSION) throw new Error(`unsupported token version ${version}`);
  const flags = take(1)[0];

  const out = {
    version,
    fingerprint: "sha256:" + bytesToHex(take(32)),
    publisherKey: bytesToHex(take(32)),
    signature: null,
    name: null,
    locations: [],
    inline: null,
  };
  if (flags & F_SIGNED) out.signature = bytesToHex(take(64));
  if (flags & F_NAME) out.name = take(take(1)[0]).toString("utf8");
  if (flags & F_LOCATIONS) {
    const count = take(1)[0];
    for (let i = 0; i < count; i++) out.locations.push(take(take(1)[0]).toString("utf8"));
  }
  if (flags & F_INLINE) {
    const len = take(2).readUInt16BE(0);
    out.inline = Buffer.from(take(len));
  }
  return out;
}

// The same token as a clickable link.
export const toUri = (token) => `skill://${token}`;
