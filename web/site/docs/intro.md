---
title: Introduction
sidebar_position: 1
slug: /
---

# Agent skills you can trust

An agent skill is a folder with a `SKILL.md` that an agent reads straight into
its context and fetches by name. That is also its weak point: whoever can change
the file changes what the agent does, after you approved it. SkillSeal turns a
skill into one line that proves what it is, so a changed skill is a different
line the agent was never approved to use.

## The problem every agent framework shares

An agent does not run a skill the way a program runs a library. It reads the
skill's text into the model's context and follows it. To the model, that text is
instructions. This is why prompt injection is the number one risk in the
[OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/),
for the second edition running: a model handles instructions and untrusted data
in the same channel, so text pulled in from a file, a page, or a tool
description can become a command it obeys.

Now place that on the open surface agents fetch from. Skills and tool
descriptions are pulled by name from registries, repositories, and servers, the
same supply chain that logged
[more than 512,000 malicious open source packages in a single year, up 156 percent](https://www.sonatype.com/state-of-the-software-supply-chain/2024/introduction),
with npm alone accounting for 98.5 percent of them. A name is a promise the
source can break at any time.

It is not theoretical. In April 2025 researchers named the
[tool poisoning attack](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks):
hide instructions inside a tool's description, and a capable model follows them
while showing you a normal reply. A proof of concept made the Cursor editor read
a private SSH key and send it away. Benchmarks across more than 45 real servers
reached [attack success above 60 percent](https://arxiv.org/abs/2508.14925), and
[Microsoft has since warned](https://thehackernews.com/2026/06/microsoft-warns-poisoned-mcp-tool.html)
that poisoned tool descriptions can make agents leak data. This lands on every
agent that loads text it did not verify, open source or closed.

The gap is simple to state: **approval is a name, and a name is mutable.** You
approve `csv-stats` today; the bytes behind that name can change tomorrow, and
nothing tells you.

## The seal

**Why.** If approval is a name, trust leaks the moment the bytes change. So
approval has to bind to the bytes, not to the name.

**How.** SkillSeal addresses a skill by the hash of its contents and signs that
address. Approval becomes a hash. A changed skill is, by definition, a different
address the agent never approved, so a change cannot pass silently. It is
refused.

**What.** The result is one line, about sixty characters, that you paste into
any agent:

```bash
npx skillseal add sk1qgq6pf8mykkwrqu2ttpynx43f57magyphegd66zrhcpfjz5mlufgaku50584ge6xhzw
```

The line carries the skill's fingerprint, its publisher's key, and their
signature. Before anything is written, the install checks every byte against it.
One altered byte and it refuses, leaving nothing on disk.

## What is a sealed skill

A sealed skill is a plain [Agent Skills](https://agentskills.io/home) folder. The
seal is additive: remove SkillSeal and the folder still works.

```
my-skill/
├── SKILL.md          # metadata and instructions
├── scripts/          # optional code
├── references/       # optional docs
└── assets/           # optional templates
```

The only new thing is the line that installs it, and what that line lets your
own machine prove.

## Why seal a skill

* **Integrity.** Every byte is checked against the address before it is written. A
  single changed byte refuses the install.
* **Provenance.** The line carries the publisher's key, so you know who published
  these exact bytes, not just a name anyone could reuse.
* **Portability.** It installs as a plain skill folder into whichever agents you
  have, and the bytes can come from any store, so nothing along the way has to be
  trusted.

## How verification works

Three steps, in order. Nothing is trusted before the step that checks it.

1. **The line.** A self verifying address. Its checksum is validated offline,
   before any network call, so a mistyped line is rejected with nothing fetched.
2. **The check.** The publisher signature is verified, then every file is hashed
   and compared to the address. A store can fail to answer; it cannot answer with
   something else.
3. **The install.** Only now is the folder written, in one move, into the skill
   directory of each agent found. If any check fails, nothing lands on disk.

## Where it works

A sealed skill is a plain Agent Skills folder, so Claude Code, Cursor, goose,
Hermes, Copilot, Gemini CLI, and every other skills reader install it with no
plugin and no integration. Browse the sealed catalogue in the
[Skills Hub](pathname:///skillseal/hub/).

## Open and compatible

SkillSeal is a natural step on top of the open Agent Skills format. It reads and
writes the folder every agent already understands, name based installs keep
working, and the seal only adds a check. Backward compatible by construction.

## Get started

* **[Quickstart](./quickstart.md)** — install a sealed skill, then seal your own.
* **[The install line](./install-line.md)** — what the line carries and why it is short.
