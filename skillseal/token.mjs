// The install token.
//
// A skill is normally installed by name, which means trusting whoever controls
// that name. This token carries the proof instead. It comes in two shapes that
// verify to the same guarantee:
//
//   v1  full          fingerprint + publisher key + signature + name +
//                     locations, all spelled out inline (~380 chars).
//   v2  pointer        one content address of a signed manifest (~60 chars).
//                     The key, signature, file list, and locations all live
//                     inside the manifest, which the address commits to. A hash
//                     of a signed manifest is strictly shorter than spelling the
//                     manifest into the line, and gives up nothing: fetch the
//                     manifest from anywhere, check its hash, and you have
//                     transitively verified everything it holds.
//
// Because the address (v2) or the fingerprint (v1) decides what is acceptable,
// the places a skill can be fetched from are only suggestions. A hostile mirror
// can fail to answer; it cannot answer with something else. That is what lets
// the token be pasted anywhere and fetched from anything.

import { encode as b32encode, decode as b32decode } from "./bech32.mjs";

const PREFIX = "sk";
const VERSION = 1;
const VERSION2 = 2;
const F_NAME = 1, F_LOCATIONS = 2, F_INLINE = 4, F_SIGNED = 8;
const P_HINT = 1; // v2 flag: a 4-byte publisher hint follows the address

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

// v2 pointer: version + flags + 32-byte manifest address (+ optional 4-byte
// publisher hint). `manifestAddress` is hex or "sha256:hex". `hint` is 4 bytes
// of hex, letting a reader recognize a pinned publisher offline; the full key
// and signature stay in the manifest.
export function createPointer({ manifestAddress, hint = null }) {
  const digest = hexToBytes(String(manifestAddress).replace(/^sha256:/, ""));
  if (digest.length !== 32) throw new Error("manifest address must be 32 bytes");
  let flags = 0;
  const tail = [];
  if (hint) {
    const h = hexToBytes(hint);
    if (h.length !== 4) throw new Error("publisher hint must be 4 bytes");
    flags |= P_HINT;
    tail.push(h);
  }
  return b32encode(PREFIX, Buffer.concat([Buffer.from([VERSION2, flags]), digest, ...tail]));
}

export function readToken(token) {
  const trimmed = String(token).trim().replace(/^skill:\/\//, "");
  const { hrp, bytes } = b32decode(trimmed);
  if (hrp !== PREFIX) throw new Error(`not a skill token (prefix "${hrp}")`);

  let o = 0;
  const take = (n) => { const b = bytes.subarray(o, o + n); o += n; return b; };
  const version = take(1)[0];
  if (version === VERSION2) {
    const flags = take(1)[0];
    const out = {
      version: 2,
      kind: "pointer",
      manifestAddress: "sha256:" + bytesToHex(take(32)),
      publisherHint: null,
    };
    if (flags & P_HINT) out.publisherHint = bytesToHex(take(4));
    return out;
  }
  if (version !== VERSION) throw new Error(`unsupported token version ${version}`);
  const flags = take(1)[0];

  const out = {
    version,
    kind: "full",
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
