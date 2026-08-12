// A tiny, dependency-free S3 client (AWS Signature v4) for any S3-compatible
// endpoint. Because it is plain S3, the SAME code runs against a Filecoin-
// backed store with no changes:
//
//   S3_PROVIDER   endpoint                         backing
//   ----------    -------------------------------  ---------------------------
//   akave         (per-credential, akave console)  Filecoin (hot + cold deals)
//   filebase      https://s3.filebase.com          IPFS + Filecoin, returns CID
//   storj         https://gateway.storjshare.io    decentralized (S3 native)
//   minio         http://127.0.0.1:9000            local stand-in (default)
//
// A kappa maps to an immutable, sharded object key:
//   sha256:ab27cf...  ->  blobs/sha256/ab/27/ab27cf...
// Content-addressed keys never change, so writes are idempotent and any
// consumer can fetch by address and verify the bytes independently.

import { createHash, createHmac } from "node:crypto";

// Region defaults per provider (Akave uses its own network region).
const PROVIDER_REGION = { akave: "akave-network", filebase: "us-east-1", storj: "us-east-1", minio: "us-east-1" };

const cfg = () => {
  const provider = process.env.S3_PROVIDER || "minio";
  return {
    provider,
    endpoint: (process.env.S3_ENDPOINT || "http://127.0.0.1:9000").replace(/\/$/, ""),
    region: process.env.S3_REGION || PROVIDER_REGION[provider] || "us-east-1",
    bucket: process.env.S3_BUCKET || "kappa-blobs",
    accessKey: process.env.S3_ACCESS_KEY || "minioadmin",
    secretKey: process.env.S3_SECRET_KEY || "minioadmin",
  };
};

export function keyForAddress(address) {
  const [axis, hex] = address.split(":");
  return `blobs/${axis}/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

// Sign and send one request. `body` is a Buffer for PUT, undefined otherwise.
async function signedRequest(method, key, body) {
  const c = cfg();
  const url = new URL(`${c.endpoint}/${c.bucket}/${key}`);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body || Buffer.alloc(0));

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope, sha256hex(Buffer.from(canonicalRequest)),
  ].join("\n");

  const kDate = hmac(`AWS4${c.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, c.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers: {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization,
    },
    body,
  });
}

export async function s3Put(address, bytes) {
  const res = await signedRequest("PUT", keyForAddress(address), Buffer.from(bytes));
  if (!res.ok) throw new Error(`S3 put failed (${res.status}): ${await res.text()}`);
}

export async function s3Get(address) {
  const res = await signedRequest("GET", keyForAddress(address));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 get failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function s3Head(address) {
  const res = await signedRequest("HEAD", keyForAddress(address));
  return res.ok;
}

// Filecoin/IPFS provenance: a Filecoin-backed S3 store (Filebase, and IPFS
// gateways generally) returns the object's IPFS content id in metadata. This
// links the kappa (integrity) to the Filecoin/IPFS location. Returns null when
// the endpoint does not supply one (e.g. plain MinIO).
export async function s3Cid(address) {
  const res = await signedRequest("HEAD", keyForAddress(address));
  if (!res.ok) return null;
  return res.headers.get("x-amz-meta-cid") || res.headers.get("x-amz-meta-ipfs-hash") || null;
}

// Raw put for the corruption test (write arbitrary bytes under an address key,
// simulating a faulty or malicious backend).
export async function s3PutRaw(address, bytes) {
  const res = await signedRequest("PUT", keyForAddress(address), Buffer.from(bytes));
  if (!res.ok) throw new Error(`S3 raw put failed (${res.status})`);
}

export function s3Config() {
  const c = cfg();
  return { provider: c.provider, endpoint: c.endpoint, bucket: c.bucket, region: c.region };
}
