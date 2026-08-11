// skill-lock -- pin and verify Agent Skills by content address.
//
// An Agent Skill is a folder with a SKILL.md that an agent loads into context
// on demand (progressive disclosure). Like an MCP tool description, SKILL.md is
// fetched by name and is mutable: whoever can write the file rewrites what the
// agent does. skill-lock pins the SKILL.md bytes to a content address and
// refuses to activate a skill whose content changed since approval.
//
// Usage:
//   node skill-lock/skill-lock.mjs approve <skill-dir> [pin-name]
//   node skill-lock/skill-lock.mjs verify  <skill-dir> [pin-name]
//
// Drop `skill-lock verify` into a skills-compatible agent's pre-activation hook
// to make every skill load content-verified, on any agent that supports Skills.

import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import {
  putBlob,
  getBlob,
  setPin,
  getPin,
  contentAddress,
  unifiedDiff,
} from "../lib/store.mjs";

function skillBytes(dir) {
  return readFileSync(join(dir, "SKILL.md"));
}

function pinNameFor(dir, explicit) {
  return explicit || `skill.${basename(dir)}`;
}

async function approve(dir, pinArg) {
  const bytes = skillBytes(dir);
  const address = contentAddress(bytes);
  const pin = pinNameFor(dir, pinArg);
  await putBlob(bytes);
  await setPin(pin, address);
  console.log(`[approve] pinned "${pin}" -> ${address}`);
  return 0;
}

async function verify(dir, pinArg) {
  const bytes = skillBytes(dir);
  const address = contentAddress(bytes);
  const pin = pinNameFor(dir, pinArg);
  const pinned = await getPin(pin);

  if (!pinned) {
    console.log(`[verify] no pin named "${pin}". Approve the skill first.`);
    return 3;
  }
  if (pinned === address) {
    console.log(`[verify] "${pin}" verified -> ${address}. Safe to activate.`);
    return 0;
  }

  const pinnedBytes = await getBlob(pinned);
  const diff = pinnedBytes
    ? unifiedDiff(pinnedBytes.toString(), bytes.toString(), "approved SKILL.md", "current SKILL.md")
    : "(approved SKILL.md body unavailable)";
  console.log("");
  console.log("  ################################################################");
  console.log(`  #  SKILL DRIFT BLOCKED for "${pin}"`);
  console.log(`  #  approved: ${pinned}`);
  console.log(`  #  current : ${address}`);
  console.log("  ################################################################");
  console.log("");
  console.log(diff);
  console.log("");
  console.log("[verify] skill content changed since approval. Activation refused.");
  return 1;
}

async function main() {
  const [cmd, dir, pinArg] = process.argv.slice(2);
  if (!cmd || !dir) {
    console.log("usage: skill-lock.mjs <approve|verify> <skill-dir> [pin-name]");
    process.exit(2);
  }
  const code = cmd === "approve" ? await approve(dir, pinArg) : cmd === "verify" ? await verify(dir, pinArg) : 2;
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
