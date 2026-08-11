// skill-lock -- pin and verify Agent Skills by content address.
//
// An Agent Skill is a folder with a SKILL.md that an agent loads into context
// on demand. Like an MCP tool description, SKILL.md is fetched by name and is
// mutable. skill-lock records the approved SKILL.md bytes in a LOCAL pin (the
// root of trust, on this disk) and refuses to activate a skill whose content
// changed since approval. A copy is published to the content-addressed store
// for audit, but the trust decision never depends on the store.
//
// Usage:
//   node skill-lock/skill-lock.mjs approve <skill-dir> [pin-name]
//   node skill-lock/skill-lock.mjs verify  <skill-dir> [pin-name]
//
// Drop `skill-lock verify` into a skills-compatible agent's pre-activation hook
// to make every skill load content-verified, on any agent that supports Skills.

import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { putBlob, setPin, contentAddress, unifiedDiff, NAMESPACE } from "../lib/store.mjs";
import { savePin, loadPin } from "../lib/pins.mjs";

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
  // Local approval is authoritative.
  savePin(NAMESPACE, pin, { address, approvedAt: new Date().toISOString(), skill: bytes.toString() });
  // Best-effort publish for audit + distribution.
  try {
    await putBlob(bytes);
    await setPin(pin, address);
  } catch (e) {
    console.log(`[approve] store publish skipped (${e.message}); local pin still authoritative`);
  }
  console.log(`[approve] pinned "${pin}" -> ${address} (local root of trust)`);
  return 0;
}

function verify(dir, pinArg) {
  const bytes = skillBytes(dir);
  const address = contentAddress(bytes);
  const pin = pinNameFor(dir, pinArg);
  const approved = loadPin(NAMESPACE, pin);

  if (!approved) {
    console.log(`[verify] no local approval for "${pin}". Approve the skill first.`);
    return 3;
  }
  if (approved.address === address) {
    console.log(`[verify] "${pin}" verified -> ${address}. Safe to activate.`);
    return 0;
  }

  const diff = unifiedDiff(approved.skill || "", bytes.toString(), "approved SKILL.md", "current SKILL.md");
  console.log("");
  console.log("  ################################################################");
  console.log(`  #  SKILL CHANGE BLOCKED for "${pin}"`);
  console.log(`  #  approved: ${approved.address}`);
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
  const code = cmd === "approve" ? await approve(dir, pinArg) : cmd === "verify" ? verify(dir, pinArg) : 2;
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
