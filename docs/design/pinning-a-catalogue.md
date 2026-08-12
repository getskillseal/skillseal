# Pinning a whole skills catalogue

The single-skill flow scales to a catalogue without changing shape: encode each
skill into its Merkle manifest, then fold every manifest into one **signed
registry root**. A subscriber holds two facts — the root address and the
publisher's key — and from those can verify the entire hub.

## Measured on the real catalogue

Run against a checkout of the upstream agent repository:

```bash
node harness/pin-hub.mjs \
  --root /path/hermes-agent/skills:builtin \
  --root /path/hermes-agent/optional-skills:official \
  --publish
```

| | |
| --- | --- |
| Skills pinned | **193** (79 built-in, 114 optional) |
| Files | 987 |
| Size | 11.8 MiB |
| Categories | 27 |
| Objects published | **1,173** (deduplicated by content address) |
| Wall clock | **32 seconds**, including publish |

The source counts match what the upstream hub reports for its built-in and
optional registries, which is the check that the ingestion is reading the right
corpus rather than an approximation of it.

Content addressing deduplicates for free: 987 files plus 193 manifests is
1,180 objects, but only 1,173 were written, because identical blobs across
skills collapse to the same address.

## The signed registry root

`harness/out/registry.json` is a canonical, sorted statement over the whole
catalogue: for each skill its name, category, source, address, and file count.
Its own content address is the **registry root**, and
`harness/out/registry-root.json` carries that root plus an ed25519 signature
over it.

This is the piece the upstream trust model lacks. There, a skill is trusted by
comparing hashes against an origin that is not itself authenticated, plus a
policy scan. Here, one signature covers every skill and version in the
catalogue at once.

## Verifying as a subscriber

```bash
node harness/verify-hub.mjs --sample 6
```

Measured output, holding only the root address and the publisher key:

```
  [ok] publisher signature over the registry root
  [ok] registry hashes to the signed root (193 skills)
  [ok] apple/apple-notes matches its listed address
  [ok] creative/heartmula matches its listed address
  ...
VERIFIED: signature valid, registry intact, 6/6 sampled skills match.
```

Corrupt any object in the bucket and the same command refuses: the bytes no
longer hash to the address the signed registry lists. Storage, transport, and
the index are all untrusted; the address is the proof.

## Cost

At 11.8 MiB the whole curated catalogue sits inside the free tier of a
Filecoin-backed S3 provider ([Filebase](https://filebase.com/) gives 5 GB, and
its paid tier is $7.50/month for 500 GB). Storage is not the constraint for a
text corpus; ingestion and safety review are.

## Scaling past the curated set

The wider ecosystem reaches tens of thousands of skills across many registries.
The encode-and-pin step stays cheap and linear; what grows is everything around
it: a resilient crawler over heterogeneous registries, a quarantine gate so
that scanning happens before publishing rather than after, and a decision about
whether each publisher signs its own namespace or one aggregator signs for all.
Those are the real costs, not the bytes.
