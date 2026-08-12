---
title: Reference
sidebar_position: 6
---

# Reference

A terse map of the pieces. For the reasoning behind them, see
[The install line](./install-line.md) and [Publisher identity](./publisher-identity.md).

## The install line

A short line, about sixty characters, in the same checksummed encoding as a
Bitcoin address, so a damaged paste is rejected offline.

```
sk1  <version>  <256 bit manifest address>  [4 byte publisher hint]  <checksum>
```

* **version** — the line format. The current form is a pointer to a signed manifest.
* **manifest address** — the sha256 of the manifest. It commits to everything inside.
* **publisher hint** — optional. Four bytes that let a reader recognize a key they
  have pinned before, without fetching anything.

The full form, which spells the fingerprint, key, signature, and file list into
the line, still decodes and installs.

## The manifest

The bytes the install line addresses. A signed core, plus the signature over it.

```json
{
  "core": {
    "v": 2,
    "name": "csv-stats",
    "publisherKey": "hex",
    "files": [ { "address": "sha256:…", "path": "SKILL.md", "size": 2488 } ],
    "locations": [ "ipfs://…" ]
  },
  "sig": "hex"
}
```

The address is the sha256 of the whole object, so fetching it by that address
proves the key, the signature, and the file list at once.

## Trust levels

Reported by `add`; never a gate, except that unsigned is refused by default.

| Level | Meaning |
| --- | --- |
| cryptographic | A domain the publisher named proved control of the key. |
| config | Trusted on first use: the same key as last time, not tied to a name. |
| unsigned | No signature. Refused unless you pass `--allow-unsigned`. |

## Commands

```bash
skillseal add sk1…            # verify a line, then install it
skillseal inspect sk1…        # read a line, fully offline
skillseal where               # the agents found on this machine
skillseal verify              # recheck every skill in skills.lock
skillseal publish ./dir       # turn a skill folder into a line
```

Common flags: `--agent <id>`, `--all`, `--to <dir>`, `--from <store>`,
`--bind <handle>`, `--allow-unsigned`, `--accept-new-key`.

## Where the bytes live

The install line names no location. An address resolves from any store that has
it: a default public mirror, an IPFS gateway, a bucket, or your own via `--from`
or `SKILLSEAL_STORES`. None is trusted, because whatever a store returns is
hashed against the address first.
