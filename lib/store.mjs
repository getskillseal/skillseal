// Minimal client for the content-addressed trust store (an OCI-style /v2/ registry).
// No dependencies. Node 18+.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export const STORE_URL = (process.env.TRUST_STORE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
export const NAMESPACE = process.env.TRUST_NAMESPACE || "fleet";

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function contentAddress(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

// Deterministic JSON: object keys sorted at every level.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function http(method, path, body, headers = {}) {
  const res = await fetch(`${STORE_URL}${path}`, { method, body, headers });
  return res;
}

export async function storeReady() {
  try {
    const res = await http("GET", "/v2/_health/ready");
    return res.ok;
  } catch {
    return false;
  }
}

// Write a blob at its content address. The store recomputes the hash and
// rejects any body that does not match the address (verify-on-write).
export async function putBlob(bytes) {
  const label = contentAddress(bytes);
  const res = await http("PUT", `/v2/${NAMESPACE}/blobs/${label}`, bytes, {
    "content-type": "application/octet-stream",
  });
  if (!res.ok && res.status !== 201) {
    throw new Error(`trust store rejected blob (${res.status}): ${await res.text()}`);
  }
  return label;
}

export async function getBlob(label) {
  const res = await http("GET", `/v2/${NAMESPACE}/blobs/${label}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`blob fetch failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// A pin is a named reference to a content address, stored server-side so the
// signed namespace root covers it.
export async function setPin(name, label) {
  const res = await http("PUT", `/v2/${NAMESPACE}/tags/${name}?kappa=${encodeURIComponent(label)}`);
  if (!res.ok && res.status !== 201) {
    throw new Error(`pin write failed (${res.status}): ${await res.text()}`);
  }
}

export async function getPin(name) {
  const res = await http("GET", `/v2/${NAMESPACE}/tags/${name}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pin fetch failed (${res.status})`);
  const body = await res.json();
  return body.kappa || null;
}

export async function listPins() {
  const res = await http("GET", `/v2/${NAMESPACE}/tags/list`);
  if (!res.ok) return [];
  const body = await res.json();
  return body.tags || [];
}

// Fetch the signed namespace root: one ed25519-signed statement covering
// every pin in the namespace.
export async function getSignedRoot() {
  const res = await http("GET", `/v2/${NAMESPACE}/_root?signed=true`);
  if (!res.ok) throw new Error(`signed root fetch failed (${res.status})`);
  return res.json();
}

// Verify the signed root locally. The store signs "{ns}\n{root}\n{timestamp}"
// with ed25519; public_key and signature are hex-encoded raw bytes.
export function verifySignedRoot(sr) {
  if (sr.algorithm !== "ed25519") throw new Error(`unexpected algorithm: ${sr.algorithm}`);
  const raw = Buffer.from(sr.public_key, "hex");
  if (raw.length !== 32) throw new Error("bad public key length");
  // Wrap the raw ed25519 key in a SPKI DER header so node:crypto accepts it.
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  const message = Buffer.from(`${sr.namespace}\n${sr.root}\n${sr.timestamp}`);
  return edVerify(null, message, key, Buffer.from(sr.signature, "hex"));
}

// Small line-level diff (LCS). Inputs are short manifests; O(n*m) is fine.
export function unifiedDiff(aText, bText, aName = "pinned", bName = "current") {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines = [`--- ${aName}`, `+++ ${bName}`];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push(`  ${a[i]}`); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { lines.push(`- ${a[i]}`); i++; }
    else { lines.push(`+ ${b[j]}`); j++; }
  }
  while (i < n) lines.push(`- ${a[i++]}`);
  while (j < m) lines.push(`+ ${b[j++]}`);
  // Collapse long unchanged runs for readability.
  const out = [];
  let run = [];
  for (const l of lines) {
    if (l.startsWith("  ")) { run.push(l); continue; }
    if (run.length > 4) {
      out.push(run[0], `  … ${run.length - 2} unchanged lines …`, run[run.length - 1]);
    } else out.push(...run);
    run = [];
    out.push(l);
  }
  if (run.length > 4) out.push(run[0], `  … ${run.length - 2} unchanged lines …`, run[run.length - 1]);
  else out.push(...run);
  return out.join("\n");
}
