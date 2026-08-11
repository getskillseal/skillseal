#!/usr/bin/env bash
# pin-the-protocol -- one command, four acts.
#
#   ./demo.sh          run the whole demo
#   ./demo.sh clean     stop the trust store and remove generated state
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

hr() { printf '%s\n' "================================================================"; }

clean() {
  bash scripts/trust-store.sh stop || true
  rm -rf evidence trust-store/data trust-store/store.log skill-lock/.work pins
  echo "cleaned."
}

if [ "${1:-run}" = "clean" ]; then clean; exit 0; fi

# 0. Dependencies
command -v node >/dev/null 2>&1 || { echo "need Node 20+"; exit 1; }
[ -d node_modules ] || { echo "installing npm deps..."; npm install --no-audit --no-fund; }

# 1. Trust store up
bash scripts/trust-store.sh start
mkdir -p evidence

# 2. Acts
hr; echo "ACT 1 -- the rug-pull, unprotected"; hr
node client/run-act1.mjs

hr; echo "APPROVE -- pin the clean server's tool manifest"; hr
node client/approve.mjs weather.v1

hr; echo "ACT 2 -- the same attack, through the verifying gateway"; hr
node client/run-act2.mjs

hr; echo "ACT 4 -- Agent Skills, same guarantee (skills are the new MCP)"; hr
node client/run-skills.mjs

hr; echo "ACT 3 -- signed, verifiable fleet state"; hr
node client/audit.mjs

hr; echo "ADVERSARIAL GATE -- attacks that must stay defended"; hr
node client/adversarial.mjs

hr
echo "ALL ACTS PASSED."
echo "Evidence written to ./evidence/ -- inspect it yourself:"
echo "  evidence/act1.json            attack succeeds unprotected"
echo "  evidence/act2.json            gateway BLOCKED verdict + drift diff"
echo "  evidence/act4.json            skill drift blocked"
echo "  evidence/act3-signed-root.json  ed25519-signed fleet state"
echo "  (adversarial gate: 3/3 attacks defended)"
hr
