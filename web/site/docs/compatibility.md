---
title: Compatibility
sidebar_position: 5
---

# Compatibility

**Why.** A sealed skill has to work everywhere a plain skill works, or the seal
is a tax. So it changes nothing an agent reads.

**How.** SkillSeal installs a plain [Agent Skills](https://agentskills.io/home)
folder, a `SKILL.md` with optional `scripts`, `references`, and `assets`. Every
agent that reads Agent Skills reads a sealed skill, with no plugin and no
integration. The seal lives in the install step, not in the folder.

**What.** `skillseal where` lists the agents found on this machine and where each
keeps its skills:

```bash
skillseal where
```

Out of the box it installs into the skills directory of Claude Code and Claude
Desktop, Hermes, goose, Cursor, Codex, OpenCode, OpenHands, Letta, Amp, Roo, and
Gemini CLI, plus the project folders for GitHub Copilot and VS Code. Support for
another agent is one line in the agent table.

## Install targets

By default a skill installs into every agent found. Narrow it when you need to:

```bash
skillseal add sk1… --agent claude      # one agent
skillseal add sk1… --all               # every agent found, not just the default
skillseal add sk1… --to ./team/skills  # a folder you choose
```

## Pin what a project depends on

`skillseal add` records each install in `skills.lock`. Commit it, and the whole
team and CI install the same bytes. `skillseal verify` reads it back and fails if
anything on disk no longer matches.

```bash
skillseal verify
```

## Backward compatibility

A sealed skill is a normal Agent Skills folder. Remove SkillSeal and it still
works. Name based installs keep working. The seal only adds a check, so nothing
you already do breaks.
