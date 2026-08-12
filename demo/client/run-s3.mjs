// ACT 5 -- self-verifying skills on distributed, S3-compatible Filecoin storage.
//
// The registry names and verifies; storage only returns bytes. This act mirrors
// a whole skill's content-addressed blobs to an S3-compatible object store,
// fetches them back BY ADDRESS, and re-verifies. It runs unchanged against a
// Filecoin-backed store -- Akave O3 (Filecoin's S3 layer) or Filebase (IPFS +
// Filecoin) -- via S3_PROVIDER/S3_ENDPOINT/credentials, and against a local
// MinIO stand-in by default. Where the store returns an IPFS/Filecoin CID, we
// record it as provenance: the kappa proves integrity, the CID names the
// Filecoin location.
//
// Finally it corrupts one object in the bucket to show the substrate is
// untrusted: a wrong byte is caught on read because the address is the proof.

import { mkdirSync, writeFileSync } from "node:fs";
import { contentAddress } from "../lib/store.mjs";
import { buildTree } from "../lib/skilltree.mjs";
import { s3Put, s3Get, s3Head, s3Cid, s3PutRaw, keyForAddress, s3Config } from "../lib/s3.mjs";

const SKILL = process.argv[2] || "../skills-ref/document/pdf-fill";

async function main() {
  const cfg = s3Config();
  const filecoin = cfg.provider === "akave" || cfg.provider === "filebase";
  console.log("=== ACT 5: self-verifying skills on S3-compatible storage ===");
  console.log(`provider: ${cfg.provider}${filecoin ? "  (Filecoin-backed)" : "  (local stand-in)"}`);
  console.log(`bucket  : ${cfg.endpoint}/${cfg.bucket}  (region ${cfg.region})\n`);

  const tree = buildTree(SKILL);
  const objects = [...tree.files.map((f) => ({ address: f.address, bytes: f.bytes, path: f.path })),
                   { address: tree.address, bytes: tree.bytes, path: "(manifest)" }];

  // 1. Mirror every content-addressed blob to the object store.
  console.log("--- store skill blobs (key = content address) ---");
  for (const o of objects) {
    await s3Put(o.address, o.bytes);
    console.log(`  PUT ${keyForAddress(o.address)}   <- ${o.path}`);
  }

  // 2. Fetch back BY ADDRESS and re-verify each object hashes to its key.
  //    Where the store is Filecoin/IPFS-backed, surface the CID as provenance.
  console.log("\n--- fetch back and re-verify (+ Filecoin/IPFS provenance) ---");
  let ok = 0;
  const provenance = [];
  for (const o of objects) {
    const got = await s3Get(o.address);
    const good = got && contentAddress(got) === o.address;
    if (good) ok++;
    const cid = await s3Cid(o.address).catch(() => null);
    if (cid) provenance.push({ path: o.path, address: o.address, cid });
    console.log(`  ${good ? "verified" : "MISMATCH"}  ${o.address.slice(0, 22)}...  ${o.path}${cid ? `  cid=${cid}` : ""}`);
  }
  const allServed = ok === objects.length && (await s3Head(tree.address));

  // 3. Untrusted-substrate test: corrupt one object in the bucket. The read
  //    must reject it because the bytes no longer hash to the address.
  console.log("\n--- corrupt one object in the bucket, then read it ---");
  const victim = objects[0];
  await s3PutRaw(victim.address, Buffer.from("TAMPERED BYTES not matching the address"));
  const corrupted = await s3Get(victim.address);
  const rejected = !corrupted || contentAddress(corrupted) !== victim.address;
  console.log(`  ${victim.path}: read ${rejected ? "REJECTED (hash != address)" : "accepted"}`);
  await s3Put(victim.address, victim.bytes); // restore for idempotence

  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/act5.json", JSON.stringify(
    { act: 5, provider: cfg.provider, filecoinBacked: filecoin, endpoint: cfg.endpoint, bucket: cfg.bucket,
      objects: objects.length, verified: ok, corruptionRejected: rejected, provenance }, null, 2));

  console.log("\n----------------------------------------------------------------");
  if (allServed && rejected) {
    console.log(`RESULT: ${ok}/${objects.length} skill objects served from ${cfg.provider} and re-verified;`);
    if (provenance.length) console.log(`        ${provenance.length} object(s) carry a Filecoin/IPFS CID.`);
    console.log("        a corrupted object was rejected on read. The store is untrusted;");
    console.log("        the skill is self-verifying because the address is the proof.");
    console.log("ACT 5: self-verifying skills on S3-compatible storage  [PASS]");
    process.exit(0);
  }
  console.log("ACT 5: substrate verification failed  [FAIL]");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
