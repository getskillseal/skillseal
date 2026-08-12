---
title: Publisher identity
sidebar_position: 4
---

# Publisher identity

**Why.** Integrity proves the bytes belong together. It does not prove who put
them there. A skill signed by a key you have never heard of is intact, but that
tells you nothing about whether to trust it. Provenance is the other half.

**How.** A publisher key is an identity on its own. Hashing the key gives a
stable, portable identifier that needs no registry and no network. A publisher
can then tie that identity to a name they control, and you can check the tie
yourself. SkillSeal reports how strong the tie is; it never decides trusted for
you.

**What.** On install, SkillSeal reports one of three levels.

| Level | Meaning |
| --- | --- |
| cryptographic | A domain the publisher named proved control of this key. |
| config | Trusted on first use: the same key as last time, but not tied to a name. |
| unsigned | No signature at all. The publisher is unproven. Refused by default. |

## Tie a key to a domain

A publisher claims a handle and proves it by serving one file. Control of the
domain is the proof, so no third party is trusted.

```bash
PUBLISHER_SEED="your-secret" skillseal publish ./my-skill --bind example.com --upload
```

Then serve the identity at a well known path on that domain:

```
https://example.com/.well-known/skillseal.json
```
```json
{ "anchors": ["anchor:72e6c729c0a9865caf9a5fb67ac8c1c61dcf1d385f56b5ef64eba38bb713a70d"] }
```

On install, SkillSeal fetches that file, confirms it lists this key, and reports
`cryptographic`. If the file is missing or does not list the key, the claim is
treated as unverified. Weaker, never fatal.

## First contact

For a publisher with no domain tie, the first install is trust on first use: the
key is recorded, and a later line signed by a different key for the same name is
surfaced rather than accepted. A domain tie upgrades this to `cryptographic`. A
publisher's key history can also be kept as a signed, append only log, so a key
change is auditable offline with no central authority.

## Honest defaults

Publishing without setting `PUBLISHER_SEED` signs with a shared demo key, and the
tool says so plainly: those signatures prove the bytes belong together, not who
made them. Unsigned lines are refused unless you pass `--allow-unsigned`.
