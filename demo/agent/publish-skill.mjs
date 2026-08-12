// Publish a skill to distributed, S3-compatible storage (Filecoin via Akave or
// Filebase; MinIO stand-in by default), and attest it.
//
// Output is the ONLY thing an agent needs to carry: the skill's content address
// and the publisher's public key. Everything else lives in distributed storage
// and is verified on fetch.
//
//   node agent/publish-skill.mjs <skill-dir>
//
// Emits a "skill card" JSON to stdout: { name, address, publisherKey, endpoint }.

import { createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { buildTree } from "../lib/skilltree.mjs";
import { s3Put, s3PutKey, attestKey, s3Config } from "../lib/s3.mjs";

const SKILL = process.argv[2] || "../skills-ref/data/csv-stats";

// Deterministic publisher key for the demo (reproducible runs). A real publisher
// loads a persistent key; the private key never leaves this process.
function keypairFromSeed(seed32) {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed32]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

async function main() {
  const seed = Buffer.from((process.env.PUBLISHER_SEED || "pin-the-protocol-demo-publisher-seed!!").slice(0, 32).padEnd(32, "!"));
  const { privateKey, publicKey } = keypairFromSeed(seed);

  const tree = buildTree(SKILL);
  const cfg = s3Config();

  // Store every file blob + the manifest, keyed by content address.
  for (const f of tree.files) await s3Put(f.address, f.bytes);
  await s3Put(tree.address, tree.bytes);

  // Attest: sign the skill address with the publisher key and store the
  // attestation beside the skill, so provenance is distributed too.
  const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const signature = edSign(null, Buffer.from(tree.address), privateKey).toString("hex");
  const attest = { address: tree.address, algorithm: "ed25519", publisherKey: pubRaw, signature };
  await s3PutKey(attestKey(tree.address), Buffer.from(JSON.stringify(attest)));

  process.stderr.write(`[publish] "${tree.manifest.name}" -> ${tree.address}\n`);
  process.stderr.write(`[publish] ${tree.files.length} file(s) + manifest + attestation stored on ${cfg.provider} (${cfg.endpoint})\n`);
  process.stdout.write(JSON.stringify({ name: tree.manifest.name, address: tree.address, publisherKey: pubRaw, endpoint: cfg.endpoint, provider: cfg.provider }) + "\n");
}

main().catch((e) => { process.stderr.write(`publish error: ${e.stack || e}\n`); process.exit(1); });
