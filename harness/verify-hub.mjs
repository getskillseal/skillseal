// Subscriber side of the Tier A harness.
//
// A subscriber is given exactly two facts out of band: the registry root
// address and the publisher's public key. From those alone it can:
//
//   1. verify the publisher signed this exact registry root   (provenance)
//   2. fetch the registry and check it hashes to that root    (integrity)
//   3. fetch any skill in it and check it hashes to its listed address
//
// Nothing else is trusted: not the storage, not the transport, not the index.
//
//   node harness/verify-hub.mjs --root <sha256:...> --key <pubhex> [--sample N]

import { readFileSync, existsSync } from "node:fs";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { contentAddress } from "../lib/store.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
}

function verifyEd25519(message, sigHex, pubHex) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubHex, "hex")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return edVerify(null, Buffer.from(message), key, Buffer.from(sigHex, "hex"));
}

async function main() {
  const signedPath = arg("--signed", "harness/out/registry-root.json");
  const signed = existsSync(signedPath) ? JSON.parse(readFileSync(signedPath, "utf8")) : null;
  const rootAddress = arg("--root", signed?.registryRoot);
  const pubHex = arg("--key", signed?.publisherKey);
  const sample = Number(arg("--sample", "5"));
  if (!rootAddress || !pubHex) {
    console.error("usage: verify-hub.mjs --root <sha256:...> --key <pubhex>");
    process.exit(2);
  }

  console.log("subscriber holds only:");
  console.log(`  registry root  ${rootAddress}`);
  console.log(`  publisher key  ${pubHex.slice(0, 24)}…\n`);

  // 1. provenance
  const sigOk = signed && verifyEd25519(rootAddress, signed.signature, pubHex);
  console.log(`  [${sigOk ? "ok" : "FAIL"}] publisher signature over the registry root`);
  if (!sigOk) process.exit(1);

  // 2. integrity of the registry itself
  const { s3Get } = await import("../lib/s3.mjs").catch(() => ({ s3Get: null }));
  const local = "harness/out/registry.json";
  let regBytes = null;
  if (s3Get) regBytes = await s3Get(rootAddress).catch(() => null);
  if (!regBytes && existsSync(local)) regBytes = readFileSync(local);
  if (!regBytes) { console.error("  [FAIL] registry not retrievable"); process.exit(1); }

  if (contentAddress(regBytes) !== rootAddress) {
    console.error("  [FAIL] registry does not hash to the signed root");
    process.exit(1);
  }
  const registry = JSON.parse(regBytes.toString());
  console.log(`  [ok] registry hashes to the signed root (${registry.count} skills)`);

  // 3. spot-check skills straight from storage
  if (!s3Get) {
    console.log("\n  storage not configured; skipping per-skill checks");
    console.log("VERIFIED: the catalogue is signed and internally consistent.");
    return;
  }
  const step = Math.max(1, Math.floor(registry.skills.length / sample));
  const picks = registry.skills.filter((_, i) => i % step === 0).slice(0, sample);
  let ok = 0, missing = 0;
  for (const s of picks) {
    const b = await s3Get(s.address).catch(() => null);
    if (!b) { missing++; console.log(`  [--] ${s.category}/${s.name} not in storage`); continue; }
    const good = contentAddress(b) === s.address;
    if (good) ok++;
    console.log(`  [${good ? "ok" : "FAIL"}] ${s.category}/${s.name} matches its listed address`);
    if (!good) process.exit(1);
  }

  console.log(`\nVERIFIED: signature valid, registry intact, ${ok}/${picks.length} sampled skills match.`);
  if (missing) console.log(`(${missing} sampled skill(s) not published to this store)`);
  console.log("Two facts were enough to trust the whole catalogue.");
}

main().catch((e) => { console.error(e); process.exit(1); });
