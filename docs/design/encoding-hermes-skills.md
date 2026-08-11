# Encoding agent skills in a content-addressed registry

This note shows how to give a whole [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) skill (or any [Agent Skills](https://agentskills.io/home) directory) a single verifiable identity and a signed provenance, using the [kappa registry](https://github.com/UOR-Foundation/kappa-registry). A working encoder is in [`skill-tree/skill-tree.mjs`](../../skill-tree/skill-tree.mjs).

## What a skill actually is

A Hermes skill is a **directory tree**, not one file:

```
category/skill-name/
  SKILL.md            required: YAML frontmatter + markdown
  scripts/            optional: executable code
  references/         optional: docs the agent reads on demand
  templates/ examples/ assets/
```

The frontmatter carries `name`, `description`, `version`, `platforms`, `author`, and `metadata.hermes.*` (tags, category, `requires_toolsets`, `fallback_for_toolsets`, `config`).

## What Hermes has today, and the gap

Hermes distributes skills through a Hub that spans **88k+ skills across every registry**, GitHub "taps" (`repo/skills/skill-name/SKILL.md`), and direct URLs. Integrity rests on **comparing local file hashes to an "origin hash" recorded at last sync**, plus **policy-based security scanning** for injection and exfiltration. Per the docs, *"No signing mechanism is described; scanning is policy-based rather than cryptographic."*

So a skill's identity is a set of loose per-file hashes tied to an **unauthenticated** origin, and trust is a scan, not a proof. That is exactly what content addressing plus a signed root fixes.

## The encoding

Four steps, all standard registry operations:

1. **Every file becomes a blob** at its own content address (`sha256`/`blake3`). The registry verifies each blob against its address on write (`DIGEST_INVALID` otherwise).
2. **A manifest** lists the tree as canonical JSON, sorted by path:
   ```json
   {
     "kind": "hermes-skill",
     "name": "pdf-fill",
     "version": "1.0.0",
     "files": [
       { "path": "SKILL.md",            "address": "sha256:101b...", "size": 686 },
       { "path": "references/fields.md","address": "sha256:84cd...", "size": 145 },
       { "path": "scripts/fill.py",     "address": "sha256:eea5...", "size": 426 }
     ]
   }
   ```
3. **The manifest's own address is the skill's identity** — a Merkle root over the tree. Change one byte of any file and the skill address changes. (Measured: tampering `scripts/fill.py` moved the skill address and the verifier named the exact file.)
4. **A signed provenance.** A local pin records the approved skill address as the root of trust; the registry's ed25519 **signed namespace root** covers it, so a publisher's skill set becomes cryptographically attestable rather than hash-compared against an unauthenticated origin.

## What each registry primitive is for

| Registry primitive | Role for skills |
| --- | --- |
| Content-addressed blobs (verify on write) | Per-file identity; a poisoned file cannot keep its address |
| Manifest blob (Merkle root) | One address for the whole skill; the thing you approve and cite |
| Graph edges (`composed-of`, `version-of`) | Tree membership and version lineage; diff two versions by edges |
| Atomic transactions | Publish a multi-file skill all-or-nothing; no half-synced skill |
| Binary bundles with delta | Ship a skill or a Hub update as one object; deltas between versions |
| Range-based reconciliation | Converge 88k+ skills across registries by exchanging range fingerprints, not full lists |
| Signed namespace root | The cryptographic signing Hermes' model lacks: attest a publisher's skill set |

## Mapping to Hermes' own mechanics

- **Progressive disclosure.** Hermes loads `skills_list()` (metadata), then `skill_view(name)`, then `skill_view(name, path)`. The manifest is the metadata layer; `skill_view` fetches individual file blobs by address and verifies on read. No change to the agent's UX.
- **Taps and the Hub.** A tap is a publisher namespace; its signed root is a one-request, verifiable statement of every skill and version it vouches for. A subscriber verifies the root against a pinned key instead of trusting the origin.
- **Agent-created skills.** `skill_manage` writes stage under `~/.hermes/pending/skills/` behind a `write_approval` gate. Encoding the pending tree yields a stable address to review and sign before it is trusted, and a diff against the prior version by per-file address.
- **Updates.** Hermes preserves user-modified skills by hash. The same check becomes "does the local tree still match the pinned address," with a precise per-file diff when it does not.

## Try it

```bash
node skill-tree/skill-tree.mjs encode skills-samples/document/pdf-fill
node skill-tree/skill-tree.mjs verify skills-samples/document/pdf-fill   # all files match
# edit any file under the skill, then:
node skill-tree/skill-tree.mjs verify skills-samples/document/pdf-fill   # names the changed file, refuses
node skill-tree/skill-tree.mjs audit  skills-samples/document/pdf-fill   # re-fetch from the store and re-verify
```
