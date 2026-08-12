---
title: Introduction
sidebar_position: 1
slug: /
---

# Skills, verified before they run

An agent loads a skill's instructions straight into its context, and it fetches
them by name. Whoever can change the file changes what the agent does, after you
approved it.

These docs describe skills that are addressed by the hash of their contents
instead. Every page shows the address an agent asks for and the per-file table
it checks on arrival, so a changed skill is a different address it was never
approved to use.

- [Bundled skills](./user-guide/skills/bundled/index.md) — the catalogue, one page per skill
- [Skills Hub](pathname:///skillseal/hub/) — search and browse the same catalogue

## How an agent uses one

```bash
node agent/skill-agent.mjs --address sha256:... --key <publisher-key>
```

The agent carries only the address and the publisher's key. It fetches the
skill from distributed, S3-compatible storage, verifies the publisher signature
and every file hash, and only then runs it.
