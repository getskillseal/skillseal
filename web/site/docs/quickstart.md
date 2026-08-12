---
title: Quickstart
sidebar_position: 2
---

# Quickstart

Install a sealed skill, then seal one of your own. You need Node 20 or newer.
Nothing else, and no account.

## Install a sealed skill

Paste the line into any agent, or run it directly:

```bash
npx skillseal add sk1qgq6pf8mykkwrqu2ttpynx43f57magyphegd66zrhcpfjz5mlufgaku50584ge6xhzw
```

You will see each check as it passes:

```
✓ token checksum is valid          caught offline, before any download
✓ signed by fc0d6de14aa30f9c…      who published these exact bytes
✓ manifest matches the address     the file list was not swapped
✓ all 4 files match their entries  no file was altered

  installed csv-stats → Claude Code / Claude Desktop
```

`skillseal where` lists the agents it found. Alter one byte of the source and
the install refuses, leaving nothing on disk.

## Seal your own

A skill is a folder with a `SKILL.md`. Turn it into a line:

```bash
skillseal publish ./my-skill --upload
```

This prints the install line other people paste. `--upload` stores the bytes so
the line resolves anywhere; drop it to print the line and store the bytes
yourself. To publish under your own key rather than the shared demo key, set a
secret first:

```bash
PUBLISHER_SEED="your-secret" skillseal publish ./my-skill --upload
```

## Read a line without installing

```bash
skillseal inspect sk1…
```

`inspect` decodes the line and shows what it claims, fully offline. Nothing is
fetched.

## Next

* **[The install line](./install-line.md)** — what the line carries and why it is short.
* **[Publisher identity](./publisher-identity.md)** — who sealed a skill, and how strongly.
