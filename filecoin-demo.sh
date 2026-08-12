#!/usr/bin/env bash
# Run the whole flow against real, distributed, S3-compatible Filecoin storage.
#
# Nothing about the code changes: Akave O3 and Filebase speak S3, so Filecoin
# is a matter of endpoint and credentials. Fill those in first:
#
#   cp .env.filecoin.example .env.filecoin   # then edit in your keys
#   ./filecoin-demo.sh
#
# What it does, end to end:
#   1. publish a skill to Filecoin-backed storage and attest it
#   2. fetch it back by address, verify, and RUN it as an agent would
#   3. corrupt an object in the bucket and prove the agent refuses it
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$ROOT"
hr() { printf '%s\n' "================================================================"; }

# Load credentials from .env.filecoin if present, else the example file.
ENVFILE=".env.filecoin"
[ -f "$ENVFILE" ] || ENVFILE=".env.filecoin.example"
set -a; . "./$ENVFILE"; set +a

missing=0
for v in S3_PROVIDER S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
  if [ -z "${!v:-}" ]; then echo "missing $v"; missing=1; fi
done
if [ "$missing" = 1 ]; then
  cat <<'EOF'

No Filecoin credentials found.

  1. cp .env.filecoin.example .env.filecoin
  2. uncomment ONE provider block and paste your keys:
       Akave O3   https://console.akave.com/     (Filecoin hot + cold deals)
       Filebase   https://console.filebase.com/  (IPFS pinned + Filecoin, returns a CID)
  3. ./filecoin-demo.sh

Everything else is already tested; only the account is yours to create.
EOF
  exit 2
fi

case "$S3_PROVIDER" in
  akave|filebase|storj) ;;
  *) echo "note: S3_PROVIDER=$S3_PROVIDER is not a Filecoin-backed provider; continuing anyway." ;;
esac

[ -d node_modules ] || npm install --no-audit --no-fund
command -v python3 >/dev/null || { echo "need python3 to run the sample skill"; exit 1; }
mkdir -p evidence

SKILL="skills-samples/data/csv-stats"

hr; echo "1. PUBLISH to $S3_PROVIDER ($S3_ENDPOINT)"; hr
CARD=$(node agent/publish-skill.mjs "$SKILL")
echo "$CARD" > evidence/filecoin-card.json
ADDR=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).address)" "$CARD")
KEY=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).publisherKey)" "$CARD")
echo "address      : $ADDR"
echo "publisherKey : $KEY"

hr; echo "2. AGENT fetches from Filecoin storage, verifies, and uses the skill"; hr
node agent/skill-agent.mjs --address "$ADDR" --key "$KEY"

hr; echo "3. Storage is untrusted: corrupt an object, agent must refuse"; hr
node -e '
import("./lib/s3.mjs").then(async (s3) => {
  const card = JSON.parse(require("fs").readFileSync("evidence/filecoin-card.json","utf8"));
  const man = JSON.parse((await s3.s3Get(card.address)).toString());
  const v = man.files.find(f => f.path.endsWith(".py")) || man.files[0];
  await s3.s3PutRaw(v.address, Buffer.from("print(\"tampered\")"));
  console.log("corrupted in bucket:", v.path);
});'
if node agent/skill-agent.mjs --address "$ADDR" --key "$KEY" >/dev/null 2>&1; then
  echo "FAIL: the agent ran a corrupted skill"; exit 1
else
  echo "PASS: the agent refused the corrupted skill before running it"
fi

hr
echo "Done on $S3_PROVIDER. The skill was stored on Filecoin-backed storage,"
echo "fetched by address, verified, used, and a tampered copy was refused."
hr
