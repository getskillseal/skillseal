# Publisher identity: a key is an anchor

SkillSeal proves two different things, and it is careful not to confuse them.

* **Integrity** — these exact bytes belong together. The install line's checksum,
  the manifest signature, and the per file hash checks deliver this. It is solid.
* **Identity** — this key belongs to who you think. This is the harder half, and
  the piece this note describes.

The design follows the kappa registry identity substrate: compute deterministic,
verifiable facts and report them; never decide "trusted" for the user.

## The anchor

Every sealed skill already carries the publisher's ed25519 public key. Hashing it
with its algorithm tag yields a self certifying **anchor**:

```
anchor = sha256(algorithm_tag || public_key_bytes)      # rendered anchor:<hex>
```

An anchor is a stable, portable identity that needs no registry, no network call,
and no blockchain. It is the same value a kappa registry computes for the same
key, so the two interoperate by construction. `skillseal inspect` and
`skillseal add` show the anchor; `skillseal publish` prints it.

An anchor says "an entity controls this key." It does not say who. That is the
job of a binding.

## Trust levels

`skillseal add` reports one of three levels, strongest first. It reports; it does
not gate (except that unsigned is refused unless you pass `--allow-unsigned`).

| Level | Meaning |
| --- | --- |
| `cryptographic` | A domain the publisher named proved control of this key (see below). |
| `config` | Trusted on first use: the same anchor as last time, but not tied to a name. |
| `unsigned` | No signature at all. The publisher is unproven. Refused by default. |

## Binding an anchor to a domain

A publisher claims a handle they control and proves it by serving one file. The
proof is control of the domain, so no third party has to be trusted.

1. Seal with the claim:

   ```bash
   PUBLISHER_SEED="your-secret" skillseal publish ./my-skill --bind example.com --upload
   ```

   This records `identity: { handle: "example.com" }` inside the signed manifest.

2. Serve the anchor list at the well known path on that domain:

   ```
   https://example.com/.well-known/skillseal.json
   ```
   ```json
   { "anchors": ["anchor:72e6c729c0a9865caf9a5fb67ac8c1c61dcf1d385f56b5ef64eba38bb713a70d"] }
   ```

3. On install, `skillseal add` fetches that file, confirms it lists the anchor
   inside the signed manifest, and reports `cryptographic`. If the file is
   missing or does not list the anchor, the binding is simply treated as
   unverified — weaker, never fatal.

Because the binding lives inside the signed manifest and the anchor is derived
from the signing key, a bound skill cannot claim a domain it was not sealed for.
Rotating keys, listing several anchors, and retiring old ones are all expressed
by editing the anchor list the domain serves.

## What this is not, yet

* First contact is still trust on first use for unbound publishers. A binding
  upgrades it to `cryptographic`; a transparency log (the kappa append only key
  directory) would make an unbound anchor's history auditable offline. That is
  the next layer and is optional depth, not required for interoperability.
* The default publish key is a shared demo seed. Publishing without setting
  `PUBLISHER_SEED` prints a loud warning: those signatures prove integrity, not
  who.

## Backward compatibility

Identity is additive. A sealed skill is still a plain Agent Skills folder, the
install line is unchanged, and a manifest with no `identity` field verifies
exactly as before. Nothing here changes what an agent reads.
