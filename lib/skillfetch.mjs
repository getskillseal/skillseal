// Fetch a skill from distributed storage, verify it end to end, and (optionally)
// execute it. Shared by the CLI agent and the MCP tool so the verification path
// is identical no matter how an agent calls it.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { contentAddress } from "./store.mjs";
import { s3Get, s3GetKey, attestKey } from "./s3.mjs";

function verifyEd25519(message, sigHex, pubHex) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubHex, "hex")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return edVerify(null, Buffer.from(message), key, Buffer.from(sigHex, "hex"));
}

// Fetch + verify only. Returns { ok, dir, manifest, steps } or { ok:false, reason }.
// The caller is responsible for rmSync(dir) when done.
export async function fetchAndVerify(address, pubHex) {
  const steps = [];

  const attestBytes = await s3GetKey(attestKey(address));
  if (!attestBytes) return { ok: false, reason: "no attestation for this skill" };
  const attest = JSON.parse(attestBytes.toString());
  if (attest.address !== address || attest.publisherKey !== pubHex)
    return { ok: false, reason: "attestation does not match address/publisher" };
  if (!verifyEd25519(address, attest.signature, pubHex))
    return { ok: false, reason: "publisher signature invalid" };
  steps.push("provenance: publisher signature over the address verifies");

  const manifestBytes = await s3Get(address);
  if (!manifestBytes || contentAddress(manifestBytes) !== address)
    return { ok: false, reason: "manifest missing or does not hash to its address" };
  const manifest = JSON.parse(manifestBytes.toString());
  steps.push(`integrity: manifest hashes to the address ("${manifest.name}" v${manifest.version})`);

  const dir = mkdtempSync(join(tmpdir(), "skill-"));
  for (const f of manifest.files) {
    const bytes = await s3Get(f.address);
    if (!bytes || contentAddress(bytes) !== f.address) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, reason: `file ${f.path} does not hash to its address` };
    }
    const dest = join(dir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  steps.push(`integrity: all ${manifest.files.length} files verified against their addresses`);
  return { ok: true, dir, manifest, steps };
}

// Execute the skill's bundled script (first *.py under scripts/) on an input.
export function executeSkill(dir, input) {
  const scriptsDir = join(dir, "scripts");
  const py = readdirSync(scriptsDir).find((n) => n.endsWith(".py"));
  if (!py) return { status: 1, stderr: "no python script in skill" };
  const run = spawnSync("python3", [join(scriptsDir, py), input], { encoding: "utf8" });
  return { status: run.status, stdout: (run.stdout || "").trim(), stderr: run.stderr || "" };
}
