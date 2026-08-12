#!/usr/bin/env bash
# An actual agent fetches a UOR-encoded skill DIRECTLY from distributed,
# S3-compatible storage, verifies it end to end, and uses it.
#
# The kappa registry is NOT started here. The agent talks only to the object
# store and carries only the skill address + publisher key. This is the
# "100% distributed, self-verifying" claim, made runnable.
#
#   ./agent-demo.sh          run against a local MinIO stand-in
#   (set S3_PROVIDER/S3_ENDPOINT/credentials to run against real Filecoin)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$ROOT"
hr() { printf '%s\n' "================================================================"; }

[ -d node_modules ] || npm install --no-audit --no-fund
command -v python3 >/dev/null || { echo "need python3 to execute the skill"; exit 1; }

# Bring up an object store (MinIO stand-in unless S3_* points elsewhere).
bash scripts/s3-store.sh start
export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
mkdir -p evidence

SKILL="../skills-ref/data/csv-stats"

hr; echo "PUBLISH -- store the skill on distributed storage, attest it"; hr
CARD=$(node agent/publish-skill.mjs "$SKILL")
echo "$CARD" > evidence/skill-card.json
ADDR=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).address)" "$CARD")
KEY=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).publisherKey)" "$CARD")
echo "skill card (all an agent needs to carry):"
echo "  address      : $ADDR"
echo "  publisherKey : $KEY"

hr; echo "AGENT -- fetch from storage, verify end to end, and use the skill"; hr
node agent/skill-agent.mjs --address "$ADDR" --key "$KEY"

hr; echo "TAMPER -- corrupt the skill's script in the bucket, agent must refuse"; hr
# Overwrite one file object with bytes that do not match its address.
node -e '
import("./lib/s3.mjs").then(async (s3) => {
  const card = JSON.parse(require("fs").readFileSync("evidence/skill-card.json","utf8"));
  const man = JSON.parse((await s3.s3Get(card.address)).toString());
  const victim = man.files.find(f => f.path.endsWith(".py")) || man.files[0];
  await s3.s3PutRaw(victim.address, Buffer.from("print(\"pwned\")"));
  console.log("corrupted object in bucket:", victim.path);
});'
if node agent/skill-agent.mjs --address "$ADDR" --key "$KEY" 2>/dev/null; then
  echo "TAMPER: agent DID NOT refuse  [FAIL]"; exit 1
else
  echo "TAMPER: agent refused the corrupted skill before executing it  [PASS]"
fi

hr; echo "AGENT DEMO PASSED."; echo "evidence/agent.json holds the verified run + skill output."; hr
