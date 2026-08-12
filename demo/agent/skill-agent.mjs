// An agent that fetches a skill DIRECTLY from distributed storage, verifies it
// end to end, and actually uses it.
//
// The agent carries only two small facts out of band: the skill's content
// ADDRESS and the publisher's PUBLIC KEY. It talks to no registry and holds no
// local copy. The manifest, every file, and the attestation are fetched from
// the distributed, S3-compatible store (Filecoin via Akave/Filebase, or a MinIO
// stand-in) and verified before use. Any mismatch aborts before execution.
//
//   node agent/skill-agent.mjs --address <sha256:...> --key <pubhex> [--input <file>]

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { s3Config } from "../lib/s3.mjs";
import { fetchAndVerify, executeSkill } from "../lib/skillfetch.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
}

async function main() {
  const address = arg("--address");
  const pubHex = arg("--key");
  const input = arg("--input");
  if (!address || !pubHex) {
    console.error("usage: skill-agent.mjs --address <sha256:...> --key <pubhex> [--input <file>]");
    process.exit(2);
  }
  const cfg = s3Config();
  console.log(`agent: fetching skill ${address.slice(0, 22)}...`);
  console.log(`       from ${cfg.provider} (${cfg.endpoint}) -- no registry, no local copy\n`);

  const v = await fetchAndVerify(address, pubHex);
  if (!v.ok) { console.error(`REFUSED: ${v.reason}`); process.exit(1); }
  for (const s of v.steps) console.log(`  [ok] ${s}`);

  console.log("\nagent: skill verified end to end. Executing it now.\n");
  const taskInput = input || join(v.dir, "examples", "sample.csv");
  const run = executeSkill(v.dir, taskInput);
  rmSync(v.dir, { recursive: true, force: true });
  if (run.status !== 0) { console.error("skill execution failed:\n" + run.stderr); process.exit(1); }

  console.log("skill output:\n  " + run.stdout);
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/agent.json", JSON.stringify(
    { address, provider: cfg.provider, verified: true, provenance: true, skill: v.manifest.name, result: safeJson(run.stdout) }, null, 2));
  console.log("\nRESULT: an agent fetched a skill from distributed storage, verified it end to");
  console.log("        end (provenance + integrity), and used it. Nothing local, nothing trusted");
  console.log("        but the address and the publisher key.  [PASS]");
}

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

main().catch((e) => { console.error(e); process.exit(1); });
