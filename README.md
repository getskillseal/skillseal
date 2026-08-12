# mcp-skills-integrity

**Approve what an agent reads by content, not by name.**

Integrity verification for MCP tool descriptions and Agent Skills, so a changed tool or skill is caught before it reaches model context.

![Without content verification an altered tool description reaches the agent and leaks a planted secret; with it, the same change is blocked before it reaches context.](docs/hero.svg)

Every line in that picture is reproduced by `./demo.sh` on your machine.

---

## The problem

Agents load a server's **tool descriptions**, and a skill's **`SKILL.md`**, directly into model context, and they fetch them **by name** every time. That text is mutable: whoever can update the server or the file changes what the agent does, after you approved it. This is the documented [MCP tool poisoning attack](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), and it applies just as cleanly to [Agent Skills](https://agentskills.io/home). Model Context Protocol is now a [Linux Foundation and AAIF project](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) at ecosystem scale, so this is the supply chain gap sitting under three [AAIF working groups](https://aaif.io/): Security and Privacy, Identity and Trust, and Observability and Traceability.

## The solution

> A verifying gateway pins each approved server's tool manifest, and each approved skill's `SKILL.md`, to its content address. Any drift is blocked and diffed before it reaches model context, and the fleet's trusted state is one signed, auditable root.

Approval stops being a name and becomes a hash. A changed tool description is, by definition, a **different address the agent never approved**, so a change is rejected outright, not merely flagged after the fact.

The content address and signed audit root are backed by the **secure, content-addressable [kappa registry](https://github.com/UOR-Foundation/kappa-registry) from The UOR Foundation**: an OCI style registry that verifies every blob against its own hash on write and signs a deterministic root over the namespace. It gives the guarantee a durable, standards-aligned home instead of an ad hoc key value store.

## What you'll see: `./demo.sh`, four acts

| Act | What runs | Result |
| --- | --- | --- |
| **1. The attack, unprotected** | A real MCP client connects directly to a vendor server. The vendor ships an update: same name, same endpoint, altered description. | The agent reads the altered text and leaks a planted secret into a tool call. **No signal.** |
| **2. The same attack, through the gateway** | Identical attack, connection routed through the verifying gateway. | Change caught, **diff printed**, altered description never enters context. Nothing leaks. |
| **3. Signed, verifiable fleet state** | Fetch the **ed25519 signed namespace root** and verify it against the **pinned** store key; present a foreign key to prove the check is real. | One request proves exactly which tool and skill versions the fleet trusts. |
| **4. Skills are the new MCP** | Approve a skill, then an attacker rewrites its `SKILL.md`. | Same content addressed guarantee: the altered skill is refused at activation, with a diff. |
| **5. Self-verifying skills on Filecoin storage** *(optional)* | Store a whole skill's blobs in S3-compatible Filecoin storage ([Akave](https://docs.akave.xyz/) or [Filebase](https://filebase.com/); MinIO stand-in by default), fetch them back by address, then corrupt one object in the bucket. | Every object re-verifies (and carries a Filecoin/IPFS CID when the provider returns one); the corrupted one is rejected on read. The store is untrusted; the skill is self-verifying because the address is the proof. |

Each act writes machine checkable proof to `./evidence/` so a skeptic can validate without trusting the terminal. Act 5 runs against a local MinIO stand-in when Docker (or a local MinIO) is available, and against real Filecoin storage by setting a few environment variables (see [`.env.filecoin.example`](.env.filecoin.example)); it is skipped when no object store is reachable.

## Drops into the agents you already use

![Works with Claude Code, Claude Desktop, goose, Cursor, GitHub Copilot, VS Code, Gemini CLI, OpenClaw, and Hermes.](docs/interop.svg)

The gateway speaks plain MCP over stdio, and `skill-lock` is a one line pre-activation check, so this drops into any MCP or Skills capable agent without code changes. Point the agent's MCP config at the gateway instead of the server; wrap skill activation with `skill-lock verify`. Copy paste configs for Claude Code, Claude Desktop, goose, Cursor, OpenClaw, Hermes, VS Code, GitHub Copilot, and Gemini CLI are in **[docs/compatibility.md](docs/compatibility.md)**.

```jsonc
// e.g. Claude Desktop or Claude Code mcpServers entry, wrapping any server:
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["gateway/gateway.mjs", "--pin", "weather.v1", "--",
               "node", "vendor/weather-server.mjs"]
    }
  }
}
```

## Quickstart

```bash
git clone https://github.com/humuhumu33/mcp-skills-integrity
cd mcp-skills-integrity
./demo.sh
```

Requirements: **Node 20+** and a **Rust toolchain** (`cargo`) to build the trust store from source on first run, or **Docker** if you'd rather not install Rust (a self contained image is built for you). The optional storage and agent demos also use **Docker or a local MinIO**, and `python3` for the sample skill's script. Linux or macOS: the content addressed store needs a POSIX filesystem.

Clean up with `./demo.sh clean`.

## How it works

```
   agent  <==MCP==>  verifying gateway  <==MCP==>  vendor MCP server
                          |
                          |   root of trust (this disk): approved manifest
                          +-- ./pins/  <-- the check reads THIS, not the store
                          |
                          +-- content addressed store (audit + distribution)
                              (verify on write blobs + ed25519 signed root)
```

The gateway is a normal MCP server to the agent and a normal MCP client to the upstream server, the same position as any [MCP gateway](https://aaif.io/projects/). Three properties make the guarantee hold rather than merely appear to:

1. **The root of trust is local.** On approval the full manifest is written to `./pins/` on the verifier's own disk. Enforcement compares the upstream against *that local record*, never against a value fetched back from the shared store. So an attacker who can write to the store cannot change what "approved" means.
2. **The whole read surface is pinned, not just descriptions.** The manifest covers everything an MCP server can place into a model's context: server `instructions`, and for every tool, prompt, and resource its name, title, description, schema, and annotations. A change in any of them is a new address.
3. **The audit key is pinned.** The store's ed25519 key is captured out of band at first approval; the signed root is later verified against that pinned key, so a substituted or attacker run store is rejected, not trusted on sight.

On every connection the gateway re-derives the address and compares to the local approval:

- **match**: forward the upstream unchanged (tools, prompts, and resources);
- **change**: refuse, print a unified diff of exactly what changed, and hand the agent nothing but a `pin_verification_failed` notice.

The store is [`UOR-Foundation/kappa-registry`](https://github.com/UOR-Foundation/kappa-registry), an OCI style `/v2/` registry used off the shelf for audit and distribution: it **verifies content on write** (a blob whose bytes don't match its address is rejected with `DIGEST_INVALID`) and signs a deterministic **namespace root** over every pin. `skill-lock` applies the identical local approve and verify flow to `SKILL.md` files.

### Adversarial gate

The three attacks that broke an earlier, naive design (overwriting the store pin, injecting outside the tool description, and forging the signed root with an attacker key) now run on every build in [`client/adversarial.mjs`](client/adversarial.mjs) and must all stay **defended**. A regression flips one and fails CI.

## Alignment with AAIF

| AAIF working group or roadmap item | What this demo shows |
| --- | --- |
| [Security and Privacy](https://aaif.io/): security by design, adversarial testing | The tool poisoning attack is reproduced, then blocked by construction. |
| [Identity and Trust](https://aaif.io/): delegation you can rely on | Approval is bound to content, not a mutable name. |
| [Observability and Traceability](https://aaif.io/): audit capabilities | A signed namespace root is a one request, verifiable audit of fleet state. |
| [MCP 2026 roadmap](https://modelcontextprotocol.io/development/roadmap): enterprise audit trails, Server Cards | The pinned manifest *is* a signed Server Card; the signed root *is* the audit trail. |
| [Agent Skills](https://agentskills.io/home): portable, cross product skills | The same guarantee extends to `SKILL.md`, unchanged. |

## Design notes: whole skill trees and a decentralized substrate

Two explorations extend the same content-addressed model beyond the demo:

- **Encoding whole agent-skill directories.** A [Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) skill is a directory (`SKILL.md` plus `scripts/`, `references/`, `assets/`), and its ecosystem trusts skills by comparing hashes against an unauthenticated origin, with no signing. [`skill-tree/skill-tree.mjs`](skill-tree/skill-tree.mjs) content-addresses the whole tree into a Merkle manifest whose address is the skill's identity, catches a change in *any* file, and gains a signed provenance from the registry root. Details: [docs/design/encoding-hermes-skills.md](docs/design/encoding-hermes-skills.md).

  ```bash
  node skill-tree/skill-tree.mjs encode skills-samples/document/pdf-fill
  node skill-tree/skill-tree.mjs verify skills-samples/document/pdf-fill
  ```
- **Self-verifying skills on Filecoin storage.** Because addresses are the proof, the storage layer is untrusted and swappable. Filecoin now has S3-compatible front doors — [Akave O3](https://docs.akave.xyz/) (Filecoin's S3 layer) and [Filebase](https://filebase.com/) (IPFS + Filecoin) — so the *same* client stores a skill on Filecoin by changing only the endpoint and credentials. **Act 5 makes this executable** ([`lib/s3.mjs`](lib/s3.mjs) + [`client/run-s3.mjs`](client/run-s3.mjs)): a skill's blobs are stored, re-verified by address, carry a Filecoin/IPFS CID as provenance, and a corrupted object is rejected on read. Design: [docs/design/storage-substrate.md](docs/design/storage-substrate.md).
- **An actual agent uses a skill from distributed storage.** `./agent-demo.sh` runs an agent that carries only a skill's content address and the publisher's key, fetches the skill **directly from the object store with no registry running**, verifies provenance (publisher signature) and integrity (every file hashes to its address), then **executes it** and returns a real result — refusing a tampered copy before running it. `agent/skill-mcp.mjs` exposes the same verify-then-run path as an MCP tool, so Claude Code, goose, or any MCP agent can use a distributed, self-verifying skill safely. Design: [docs/design/agent-uses-skill.md](docs/design/agent-uses-skill.md).

  ```bash
  ./agent-demo.sh
  ```
- **A Skills Hub you can browse.** [`hub/index.html`](hub/index.html) is a skills catalogue in the familiar hub layout (search, category chips, expandable cards), with one difference that matters: every card carries the skill's **content address** and its **Filecoin CID**, and shows a verified seal because an agent can prove it before use. `node hub/build-catalog.mjs` regenerates the catalogue with real addresses from encoded skills.

  ```bash
  node hub/build-catalog.mjs        # real addresses -> hub/catalog.json
  python3 -m http.server -d hub 8899
  ```
- **Documentation on the same platform the ecosystem already uses.** [`website/`](website/) is a Docusaurus 3 site, matching the upstream skills docs route for route: `/docs/user-guide/skills/bundled/{category}/{category}-{name}`. `generate-skill-docs.mjs` turns every `SKILL.md` into a page carrying that skill's address and per file table, computed at generation time so the docs and the bytes an agent fetches cannot drift apart.

  ```bash
  cd website && npm install && npm start   # generates skill pages, then serves
  ```

## Honest limitations

- The guarantee protects the **read surface** an agent loads: tool and prompt and resource text, schemas, annotations, and server instructions. A server that behaves maliciously *at call time without changing any of that* is a separate problem (runtime behavior, not supply chain).
- The store's key is pinned **trust on first use**: the first approval records it. If the very first approval already talks to an impostor store, that impostor is what gets pinned. Distributing the expected key ahead of time closes this; it is out of scope for the demo.
- The store's authorization is permissive, but it is no longer load bearing: enforcement trusts the local `./pins/` record, so store write access does not grant an attacker control over approvals (see the adversarial gate). The store still holds blobs and the audit root.
- Single node store; horizontal deployment and external identity are out of scope for the demo.
- The "agent" in Acts 1 and 2 is a deliberately naive, model free stand-in that follows instructions found in tool descriptions, exactly the behavior that makes the attack real, so the demo is deterministic and safe to run in CI.

## Repository map

| Path | Responsibility |
| --- | --- |
| `gateway/gateway.mjs` | The verifying MCP gateway (approve and enforce). |
| `lib/pins.mjs` | The local root of trust: approved manifests and the pinned store key. |
| `lib/manifest.mjs` | Capture the full server read surface as a stable, hashable manifest. |
| `lib/store.mjs` | Store client: content address, blobs, signed root verification, diff. |
| `vendor/weather-server.mjs` | A real MCP server; `POISON=1` serves the altered variant. |
| `skill-lock/skill-lock.mjs` | Pin and verify a single-file Agent Skill by content address. |
| `skill-tree/skill-tree.mjs` | Content-address a whole skill directory as a Merkle manifest. |
| `lib/s3.mjs` | Dependency-free S3 client (SigV4) for any S3-compatible endpoint. |
| `client/run-s3.mjs` | Act 5: serve a skill from S3 and re-verify by address. |
| `scripts/s3-store.sh` | Start/stop a MinIO object store (Docker or local binary). |
| `agent/publish-skill.mjs` | Store a skill on distributed storage and attest it (ed25519). |
| `agent/skill-agent.mjs` | An agent that fetches, verifies, and runs a skill from storage. |
| `agent/skill-mcp.mjs` | The same verify-then-run path as an MCP `use_skill` tool. |
| `agent-demo.sh` | The agent demo: fetch a skill from storage, verify, use, refuse tamper. |
| `hub/` | A Skills Hub browser: search, categories, and per skill address + CID. |
| `client/adversarial.mjs` | The adversarial regression gate (attacks that must stay defended). |
| `docs/design/` | Design notes: encoding skill trees, and the storage substrate. |
| `client/` | The scripted acts and the naive agent stand-in. |
| `scripts/trust-store.sh` | Start and stop the content addressed trust store. |
| `docs/compatibility.md` | Copy paste configs for popular agents. |

## Sources

- [AAIF](https://aaif.io/), [AAIF projects](https://aaif.io/projects/), [Linux Foundation announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices), [MCP roadmap](https://modelcontextprotocol.io/development/roadmap), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [Invariant Labs: MCP Tool Poisoning Attacks](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)
- [Agent Skills](https://agentskills.io/home), [goose](https://github.com/block/goose), [UOR-Foundation/kappa-registry](https://github.com/UOR-Foundation/kappa-registry)

## License

MIT
