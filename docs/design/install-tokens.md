# One line, any agent, checked before it lands

Installing a skill normally looks like this:

```
hermes skills install merge-reconciler
```

That is a **name**. It only works where a registry knows the name, it trusts
whoever controls that name, and it says nothing about the bytes you receive.

This is the same install, as a token:

```
npx skillx add sk1qyx…
```

The token carries the proof with it, so the registry becomes optional and the
download becomes untrusted.

## What is inside the token

| | |
| --- | --- |
| Fingerprint | the hash of the skill's contents — what counts as correct |
| Publisher key | who vouches for it |
| Signature | proof they vouched for exactly these contents |
| Locations | optional places to look, none of them trusted |
| Name | a label for humans, never used to decide anything |
| Contents | for a very small skill, the skill itself travels inside the token |

It is written in bech32m, the same encoding as a Lightning invoice: it has a
checksum, so a token damaged by copy and paste is rejected instantly and
offline, and it has no look-alike characters. A typical token is about 250
characters.

## What happens when you paste it

```
✓ token checksum is valid
✓ signed by 5a142b0c2d720f3d…
✓ file list matches the token
✓ all 4 files match their entries

  installed csv-stats → Claude Code / Claude Desktop
```

In order:

1. **the checksum**, offline, before any network call
2. **the signature**, so you know who published these exact contents
3. **the file list**, which must hash to the fingerprint in the token
4. **every file**, which must hash to its entry in that list
5. **only then** is anything written where an agent can see it

Nothing is executed during an install. Installing a skill never runs it.

If any check fails, the install refuses and **nothing is written** — measured:
corrupting one file in the source leaves zero files on disk.

## Why any host will do

Files are stored under a path derived from their own fingerprint, so an S3
bucket, a static web server, an IPFS gateway, or a Filecoin-backed provider all
work without changes. Every location in the token is tried at once and the
first correct answer wins.

Because the fingerprint decides what is acceptable, a hostile mirror can only
fail to answer. It can never answer with something else. That is what makes it
safe to fetch from infrastructure nobody vetted, which is what "decentralized"
has to mean in practice.

## Why it works in every framework

There is no plugin. A skill is installed as a plain
[Agent Skills](https://agentskills.io/home) folder — a `SKILL.md` with its
frontmatter, plus any `scripts/`, `references/` and `assets/` — placed where the
agent already looks. Claude Code, Hermes, goose, Cursor, Codex, OpenCode,
OpenHands, Letta, Amp, Gemini CLI and Copilot all read that format today, so
support is a line in a table rather than an integration, and progressive
disclosure keeps working untouched.

```bash
skillx where     # which agents are on this machine
skillx add sk1…  # install for the ones found
```

Nothing existing breaks: name-based installs keep working, and the token is
simply another accepted argument.

## Pasting into a chat instead of a shell

The same checks are exposed as an MCP tool, `install_skill(token)`, so an agent
can accept a pasted token directly and report what it verified — or refuse.

## Publishing

```bash
skillx publish ./my-skill --from https://s3.filebase.com/my-bucket
```

This prints the fingerprint, the publisher key, and the ready-to-paste line.
Upload each file under its fingerprint and the skill is installable by anyone,
anywhere, with no account and no registry entry.

## What the token does not tell you

It proves **who** published a skill and that the bytes are **exactly** what they
published. It does not tell you the skill is well behaved. Reading a skill
before you run it still matters; the token removes the question of whether you
are reading the same thing the agent will run.

Key trust is on first use: the first token from a publisher establishes their
key, and a later change is surfaced rather than accepted silently.
