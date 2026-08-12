# Agents and SkillSeal

SkillSeal installs a skill as a plain [Agent Skills](https://agentskills.io/home)
folder: a directory with a `SKILL.md` and optional `scripts/`, `references/`,
and `assets/`. Nothing about the format changes, so every agent that reads
Agent Skills reads a sealed skill with no plugin and no integration. The only
addition is the seal: one line that proves what the folder is before it lands.

## How an agent gets a sealed skill

```bash
npx skillseal add sk1…      # verify the line, then write the folder
```

`skillseal add` checks the line's checksum offline, verifies the publisher
signature and every file hash, and only then writes the folder into the skills
directory of each agent it finds. Discovery, activation, and execution then work
exactly as they do for any Agent Skill.

## Where it installs

`skillseal where` lists the agents found on the machine. Out of the box it
writes to the skills folder of Claude Code and Claude Desktop, Hermes, goose,
Cursor, Codex, OpenCode, OpenHands, Letta, Amp, Gemini CLI, and GitHub Copilot.
Support for another agent is one line in [`skillseal/agents.mjs`](skillseal/agents.mjs).

## Backward compatibility

* A sealed skill is a normal Agent Skill folder. Remove SkillSeal and the folder
  still works.
* Name based installs keep working; the seal is additive.
* The install line is content addressed, so it resolves from any store and none
  has to be trusted.

## Using a sealed skill as a tool

An agent can fetch, verify, and run a skill straight from storage with the same
verify then run path exposed as an MCP tool. See
[`demo/agent/skill-mcp.mjs`](demo/agent/skill-mcp.mjs) and
[docs/design/agent-uses-skill.md](docs/design/agent-uses-skill.md).
