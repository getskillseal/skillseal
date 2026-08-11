// ACT 3 -- the audit trail, with a pinned key.
//
// One request returns a signed statement of the fleet's trusted state: every
// pin in the namespace, folded into a deterministic root and signed with
// ed25519. We verify the signature against the store key PINNED locally at
// approval time. That is the difference between authenticity and mere self-
// consistency: a signature is only meaningful against a key you already trust.

import { mkdirSync, writeFileSync } from "node:fs";
import { getSignedRoot, verifySignedRoot, listPins } from "../lib/store.mjs";
import { loadStoreKey } from "../lib/pins.mjs";
import { NAMESPACE } from "../lib/store.mjs";

async function main() {
  console.log("=== ACT 3: signed, verifiable fleet state (pinned key) ===");

  const pinnedKey = loadStoreKey(NAMESPACE);
  if (!pinnedKey) {
    console.log("no pinned store key found; approve something first.  [FAIL]");
    process.exit(1);
  }

  const pins = await listPins();
  const sr = await getSignedRoot();
  const ok = verifySignedRoot(sr, pinnedKey);

  // Prove the key pinning is real: a signed root from a DIFFERENT key (an
  // attacker-controlled store) must be rejected before any signature math.
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey } = generateKeyPairSync("ed25519");
  const foreignKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const foreignRoot = { ...sr, public_key: foreignKey };
  const foreignRejected = verifySignedRoot(foreignRoot, pinnedKey) === false;

  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/act3-signed-root.json", JSON.stringify(sr, null, 2));

  console.log(`\npinned entries in namespace : ${pins.length ? pins.join(", ") : "(none)"}`);
  console.log(`namespace root  : ${sr.root}`);
  console.log(`algorithm       : ${sr.algorithm}`);
  console.log(`pinned key      : ${pinnedKey.slice(0, 16)}...`);
  console.log(`timestamp       : ${sr.timestamp}`);
  console.log("----------------------------------------------------------------");
  console.log(`signature valid against pinned key : ${ok}`);
  console.log(`foreign-key root rejected          : ${foreignRejected}`);
  console.log("----------------------------------------------------------------");

  if (ok && foreignRejected) {
    console.log("RESULT: the fleet's trusted state is provable and tied to a key we already trust.");
    console.log("ACT 3: signed root verified against pinned key  [PASS]");
    process.exit(0);
  }
  console.log("ACT 3: signed root failed verification  [FAIL]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
