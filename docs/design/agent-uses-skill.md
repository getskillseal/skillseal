# An agent uses a skill directly from distributed storage

This is the end-to-end test: an agent fetches a UOR-encoded skill **directly from
distributed, S3-compatible storage** (Filecoin via Akave or Filebase; a MinIO
stand-in by default), verifies it, and **actually uses it** — with no registry
running and no local copy of the skill.

## What the agent carries

Two small facts, out of band:

- the skill's **content address** (`sha256:...`) — what to fetch;
- the publisher's **ed25519 public key** — who to trust.

Everything else (the manifest, every file, the attestation) comes from the
distributed store and is verified before use.

## The loop

```
address + publisher key
        │
        ▼
1. fetch attestation  → verify the publisher signed THIS address     (provenance)
2. fetch manifest     → verify it hashes to the address              (integrity)
3. fetch every file   → verify each hashes to its manifest address   (integrity)
4. materialize + run the skill on the task input                     (use)
```

Any hash or signature mismatch aborts **before** execution. The store is
untrusted; the skill is self-verifying because the address is the proof. This
is exactly the tested behaviour:

- clean skill → provenance + integrity verify → the skill runs and returns its result;
- one file corrupted in the bucket → the agent refuses before running anything.

## Run it (MinIO stand-in)

```bash
./demo/agent-demo.sh
```

It starts an object store, publishes the sample `csv-stats` skill, then a
command-line agent fetches it from storage, verifies it, runs it, and prints the
result — then a tampered copy is refused.

## Run it against real Filecoin

The agent code does not change; point it at a Filecoin-backed S3 endpoint:

```bash
set -a; . ./demo/.env.filecoin.example; set +a     # fill in Akave or Filebase creds
node demo/agent/publish-skill.mjs skills-ref/data/csv-stats   # prints a skill card
node demo/agent/skill-agent.mjs --address <sha256:...> --key <publisherKey>
```

## Use it from a real agent (MCP)

`demo/agent/skill-mcp.mjs` exposes one MCP tool, `use_skill`, that runs the same
verify-then-execute path and returns the result (or refuses). Any MCP-capable
agent can call it. Add it to the agent's MCP config:

```jsonc
// Claude Code / Claude Desktop mcpServers, goose, Cursor, ... :
{
  "mcpServers": {
    "skill-from-storage": {
      "command": "node",
      "args": ["/abs/path/demo/agent/skill-mcp.mjs"],
      "env": {
        "S3_PROVIDER": "filebase",
        "S3_ENDPOINT": "https://s3.filebase.com",
        "S3_BUCKET": "your-bucket",
        "S3_ACCESS_KEY": "…",
        "S3_SECRET_KEY": "…"
      }
    }
  }
}
```

Then the model calls `use_skill(address, publisherKey)` and receives a verified
result, or a refusal if provenance or integrity fails. The model never sees
unverified skill bytes.
