// A publisher's key history, offline auditable, no central authority.
//
// This is the elegant minimum of the kappa append only key directory: a
// content addressed, hash chained, signed succession log. Each entry commits to
// the previous one (the previd pattern), and a key change is authorized by the
// PREVIOUS key — you cannot append to a chain you do not hold. So anyone with
// just the log can verify an anchor's whole history, detect a fork (two entries
// with the same predecessor), and catch an unauthorized takeover, without
// trusting any registry or network.
//
//   entry = { v:1, key, anchor, prev, ts, handle?, method? }   + sig
//     anchor = anchorOf(key)                    (the uor-addr canonical anchor)
//     prev   = sha256 of the previous entry     ("" for the genesis entry)
//     sig    = ed25519 over the entry without sig, by the PREVIOUS key
//              (genesis is self signed by its own key)

import { createHash, sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";
import { anchorOf } from "./identity.mjs";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const canonical = (e) => Buffer.from(JSON.stringify({
  v: 1, key: e.key, anchor: e.anchor, prev: e.prev, ts: e.ts,
  ...(e.handle ? { handle: e.handle, method: e.method || "well-known" } : {}),
}), "utf8");
const entryAddress = (e) => sha256hex(canonical(e));

function pub(hex) {
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]), format: "der", type: "spki" });
}

// Append an entry to a log. `prevLog` is the existing entries ([] for genesis).
// `signWith` is the PRIVATE key that authorizes this entry: for a genesis it is
// the entry's own key; for a rotation it is the PREVIOUS anchor's key.
export function appendLog(prevLog, { key, ts, handle = null, method = null, signWith }) {
  const prev = prevLog.length ? entryAddress(prevLog[prevLog.length - 1]) : "";
  const entry = { v: 1, key, anchor: anchorOf(key), prev, ts, ...(handle ? { handle, method: method || "well-known" } : {}) };
  entry.sig = edSign(null, canonical(entry), signWith).toString("hex");
  return [...prevLog, entry];
}

// Verify a log end to end, offline. Returns the current head { anchor, key,
// handle } and the ordered anchor history, or throws on the first break.
export function verifyLog(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("empty log");
  let prevAddr = "", prevKey = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.v !== 1 || !e.key || !e.sig) throw new Error(`entry ${i} is malformed`);
    if (e.anchor !== anchorOf(e.key)) throw new Error(`entry ${i} anchor does not match its key`);
    if (e.prev !== prevAddr) throw new Error(`entry ${i} does not chain to the previous entry (fork or gap)`);
    const authKey = i === 0 ? e.key : prevKey;            // predecessor authorizes the successor
    if (!edVerify(null, canonical(e), pub(authKey), Buffer.from(e.sig, "hex"))) {
      throw new Error(`entry ${i} is not signed by the ${i === 0 ? "genesis" : "previous"} key`);
    }
    prevAddr = entryAddress(e);
    prevKey = e.key;
  }
  const head = entries[entries.length - 1];
  return { anchor: head.anchor, key: head.key, handle: head.handle || null, history: entries.map((e) => e.anchor) };
}

export { entryAddress };
