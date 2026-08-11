// ACT 3 -- the audit trail.
//
// One request returns a signed statement of the entire fleet's trusted state:
// every pin in the namespace, folded into a deterministic root and signed with
// ed25519 by the trust store. We verify the signature locally -- no trust in
// the transport, the store, or the network. This is the enterprise audit-trail
// requirement on the MCP roadmap, answered in a single call.

import { mkdirSync, writeFileSync } from "node:fs";
import { getSignedRoot, verifySignedRoot, listPins } from "../lib/store.mjs";

async function main() {
  console.log("=== ACT 3: signed, verifiable fleet state ===");

  const pins = await listPins();
  const sr = await getSignedRoot();
  const ok = verifySignedRoot(sr);

  // Prove the verification is real: flip one hex nibble in the root and the
  // signature must fail.
  const forged = { ...sr, root: sr.root.slice(0, -1) + (sr.root.slice(-1) === "0" ? "1" : "0") };
  const forgedRejected = verifySignedRoot(forged) === false;

  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/act3-signed-root.json", JSON.stringify(sr, null, 2));

  console.log(`\npinned tools/skills in namespace : ${pins.length ? pins.join(", ") : "(none)"}`);
  console.log(`namespace root  : ${sr.root}`);
  console.log(`algorithm       : ${sr.algorithm}`);
  console.log(`public key      : ${sr.public_key.slice(0, 16)}...`);
  console.log(`timestamp       : ${sr.timestamp}`);
  console.log("----------------------------------------------------------------");
  console.log(`signature valid        : ${ok}`);
  console.log(`forged root rejected   : ${forgedRejected}`);
  console.log("----------------------------------------------------------------");

  if (ok && forgedRejected) {
    console.log("RESULT: the fleet's trusted-tool state is provable and tamper-evident.");
    console.log("ACT 3: signed root verified locally  [PASS]");
    process.exit(0);
  }
  console.log("ACT 3: signed root failed verification  [FAIL]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
