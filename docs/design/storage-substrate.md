# A decentralized storage substrate: Filecoin and S3

The [kappa registry](https://github.com/UOR-Foundation/kappa-registry) is content addressed: a blob's name is the hash of its bytes, and reads are verified against that hash. That single property makes the storage layer **replaceable and untrusted** — the registry does the naming, verification, trust (signed roots), and graph; the substrate underneath only has to return bytes, and a wrong byte is caught on read.

So "where the bytes live" becomes a deployment choice, not a trust decision.

This is executable in the repo. **Act 5** ([`client/run-s3.mjs`](../../client/run-s3.mjs), [`lib/s3.mjs`](../../lib/s3.mjs)) mirrors a whole skill's blobs to MinIO over the real S3 API, fetches them back by address, re-verifies each, then corrupts one object in the bucket and shows the read rejected. `lib/s3.mjs` is a dependency-free SigV4 client, so the same code runs unchanged against AWS S3, Cloudflare R2, or Storj.

## The key insight: the substrate does not have to be trusted

For every blob, `read(address)` fetches bytes from somewhere and checks `hash(bytes) == address` before use. A malicious or faulty backend can withhold or corrupt data (an availability problem) but cannot substitute different data under the same address (an integrity problem). Integrity is settled by the address; the substrate is judged only on durability and latency. This is what lets a registry stand on commodity object storage or a decentralized network without inheriting their trust assumptions.

## Tiered substrate

The store's blob backend is a small interface — `put(address, bytes)`, `get(address)`, `has(address)` — behind which any of these can sit, or several at once:

| Tier | Backend | Why | Trust |
| --- | --- | --- | --- |
| 0 | Local filesystem (today) | Single node, fast | n/a |
| 1 | **S3-compatible** object store (AWS S3, MinIO, Cloudflare R2, Storj) | Durable, cheap, horizontal; ubiquitous tooling | Untrusted: verify on read |
| 2 | **Filecoin / IPFS** | Decentralized durability, verifiable deals, public retrievability | Untrusted: verify on read |

Because addresses are the proof, a read can **fan out** — try the local cache, then S3, then an IPFS gateway — and accept the first response that verifies. Writes can **mirror** to more than one tier for durability.

## S3-compatible mapping

A kappa is already a stable, sharded key. Map it straight onto an object key:

```
address:  sha256:ab27cf7f3afa...069450f06
S3 key:   blobs/sha256/ab/27/ab27cf7f3afa...069450f06
```

`put` is `PutObject`, `get` is `GetObject`, `has` is `HeadObject`. Content-addressed keys are immutable, so caching is trivial and overwrites are no-ops (the bytes for an address never change). This works unchanged against AWS S3, MinIO (self-hosted), R2 (no egress fees), or **Storj** — which is itself decentralized *and* S3-compatible, so it satisfies both asks at once with no extra code.

The registry's own tags/roots stay authoritative; S3 is a bit bucket. Existing S3-native consumers can read the same objects directly and verify them independently.

## Filecoin, through the same S3 API

Filecoin now has S3-compatible front doors, so the mapping above *is* the Filecoin mapping. No new client, no new code path:

| Provider | Endpoint | Backing | Notes |
| --- | --- | --- | --- |
| [Akave O3](https://docs.akave.xyz/) | per-credential (Akave console), region `akave-network` | Filecoin: hot cache + cold deals | Filecoin's own S3 layer, onchain verifiability |
| [Filebase](https://filebase.com/) | `https://s3.filebase.com` | IPFS pinned + Filecoin | returns the object's IPFS CID in metadata |
| [Storj](https://storj.io/) | `https://gateway.storjshare.io` | decentralized (erasure-coded) | S3-native, not Filecoin, but distributed |

Because a kappa is the S3 key, storing a skill on Filecoin is a change of endpoint and credentials, nothing else (see [`.env.filecoin.example`](../../.env.filecoin.example)). Where the provider returns an IPFS/Filecoin CID, the registry records `address -> CID` as provenance: **the kappa proves the bytes are right; the CID names where Filecoin holds them.** Two integration depths, usable together:

1. **Hot path (IPFS/Akave/Filebase).** Objects are pinned and served over the S3 API; retrieval is a gateway; the registry re-verifies against the kappa, so an untrusted gateway is fine.
2. **Cold path (Filecoin deals).** The provider (Akave, or Filebase/Lighthouse/web3.storage) makes storage deals for durable, incentivized retention; the deal and CID are provenance edges, so "where is this skill archived and under what deal" is a query, not a spreadsheet.

Filecoin's proofs answer *"is this still stored"*; the kappa answers *"is this the right bytes."* They compose: durable **and** correct. Act 5 exercises exactly this flow, defaulting to a local MinIO stand-in and switching to Filecoin by environment.

## What changes in the registry

Minimal and contained:

- Introduce a `BlobBackend` trait with `put/get/has`, and make the filesystem store one implementation. (`src/store/fs/blob.rs` becomes `backend/fs.rs`; add `backend/s3.rs`, `backend/ipfs.rs`.)
- Configure the backend and mirror/fan-out policy by environment, matching the existing config style.
- Keep verify-on-write and verify-on-read at the store boundary so every backend is held to the address regardless of where bytes came from.
- Namespace metadata, tags, edges, GC, and signed roots are unchanged; they already sit above the blob layer.

## How it lands for agent skills

A skill encoded as a Merkle manifest (see [encoding-hermes-skills.md](encoding-hermes-skills.md)) is a set of content-addressed blobs plus one manifest. Put those blobs on S3 for hot serving and pin the manifest to Filecoin for durable, decentralized archival. An agent anywhere fetches by address from the nearest tier and verifies locally, so a skill's identity and safety never depend on which storage answered — only on the address it asked for.
