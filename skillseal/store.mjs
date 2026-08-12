// Uploading, for publishers only.
//
// Installing needs nothing from this file: it is a plain web fetch, which is
// why anyone can install without an account. Publishing does need write access,
// so this signs requests the standard S3 way and works against any S3
// compatible store: Filebase and Akave (both Filecoin backed), Storj, MinIO,
// AWS. Kept dependency free so the package installs instantly.

import { createHash, createHmac } from "node:crypto";

const cfg = () => ({
  endpoint: (process.env.S3_ENDPOINT || "").replace(/\/$/, ""),
  region: process.env.S3_REGION || (process.env.S3_PROVIDER === "akave" ? "akave-network" : "us-east-1"),
  bucket: process.env.S3_BUCKET || "",
  accessKey: process.env.S3_ACCESS_KEY || "",
  secretKey: process.env.S3_SECRET_KEY || "",
});

export const configured = () => {
  const c = cfg();
  return Boolean(c.endpoint && c.bucket && c.accessKey && c.secretKey);
};

// Files live under a path derived from their own fingerprint, so any host can
// serve them and any client can check what it got.
export function keyFor(fingerprint) {
  const hex = fingerprint.replace(/^sha256:/, "");
  return `blobs/sha256/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();

async function signedRequest(method, key, body) {
  const c = cfg();
  if (!configured()) throw new Error("set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY to publish");
  const url = new URL(`${c.endpoint}/${c.bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body || Buffer.alloc(0));

  const canonicalHeaders =
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(Buffer.from(canonicalRequest))].join("\n");
  const signing = hmac(hmac(hmac(hmac(`AWS4${c.secretKey}`, dateStamp), c.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signing).update(stringToSign).digest("hex");

  return fetch(url, {
    method,
    headers: {
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
}

export async function put(fingerprint, bytes) {
  const res = await signedRequest("PUT", keyFor(fingerprint), Buffer.from(bytes));
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${await res.text()}`);
}

// Stores that pin to IPFS hand back an address for the object. Recording it
// gives the skill a second, public way to be fetched later.
export async function ipfsAddress(fingerprint) {
  const res = await signedRequest("HEAD", keyFor(fingerprint));
  if (!res.ok) return null;
  return res.headers.get("x-amz-meta-cid") || res.headers.get("x-amz-meta-ipfs-hash") || null;
}

export const publicUrlBase = () => {
  const c = cfg();
  if (!c.endpoint || !c.bucket) return null;
  const u = new URL(c.endpoint);
  return `${u.protocol}//${c.bucket}.${u.host}`;
};
