// bech32m (BIP-350). No dependencies.
//
// Why this and not base64: the encoding carries a checksum, so a token damaged
// by copy and paste is rejected instantly, offline, before anything is fetched.
// It is also case-insensitive and free of look-alike characters.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M = 0x2bc830a3;

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

// Regroup bits, e.g. 8-bit bytes to 5-bit symbols and back.
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits > 0) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

export function encode(hrp, bytes) {
  const data = convertBits([...bytes], 8, 5, true);
  const chk = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ BECH32M;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((chk >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}

export function decode(str) {
  const s = str.trim();
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new Error("mixed case");
  const low = s.toLowerCase();
  const pos = low.lastIndexOf("1");
  if (pos < 1 || pos + 7 > low.length) throw new Error("malformed token");
  const hrp = low.slice(0, pos);
  const data = [];
  for (const c of low.slice(pos + 1)) {
    const d = CHARSET.indexOf(c);
    if (d === -1) throw new Error(`invalid character "${c}"`);
    data.push(d);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== BECH32M) {
    throw new Error("checksum failed: the token is damaged or mistyped");
  }
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (!bytes) throw new Error("malformed payload");
  return { hrp, bytes: Buffer.from(bytes) };
}
