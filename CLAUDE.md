# CLAUDE.md

Guidance for Claude and other agents working in this repository.

## What this is

SkillSeal is a natural evolution of [Agent Skills](https://agentskills.io/home):
the same portable folder with a `SKILL.md`, plus a seal — one short line that
proves the fingerprint, the publisher key, and the signature before anything is
written. A sealed skill stays a plain Agent Skills folder, so it is backward
compatible by construction.

## Layout

```
skillseal/   the CLI and library (npm: skillseal) — the product
skills-ref/  reference skills, each a folder with a SKILL.md
web/hub/     the Sealed Skills browser (static)
web/site/    the docs site (static)
docs/        design notes and assets
demo/        a runnable security demo, proof in demo/evidence/
```

## Working here

* The install line and the manifest live in [`skillseal/`](skillseal/). Anything
  touching them needs a test in [`skillseal/test/`](skillseal/test/).
* A sealed skill must stay a plain Agent Skills folder. Backward compatibility is
  not negotiable.
* Keep the surface small and the prose plain. A change that adds a folder or a
  flag should earn it.
* See [AGENTS.md](AGENTS.md) for how an agent installs and uses a sealed skill.

## Verify your changes

```bash
node skillseal/test/v2.test.mjs   # the CLI test suite
./demo/demo.sh                    # the security demo
```
