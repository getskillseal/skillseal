# mcpskillsintegrity

**Approve what an agent reads by content, not by name.**

Integrity verification for MCP tool descriptions and Agent Skills, so a silently rewritten tool or skill is caught before it reaches model context.

![Without the gateway a poisoned tool description reaches the agent and leaks a canary; with the verifying gateway the same attack is blocked before it enters context.](docs/hero.svg)

Every line in that picture is reproduced by `./demo.sh` on your machine.

---

## The problem

Agents load a server's **tool descriptions**, and a skill's **`SKILL.md`**, directly into model context, and they fetch them **by name** every time. That text is mutable: whoever can update the server or the file rewrites what the agent does, after you approved it. This is the documented [MCP tool poisoning "rug pull" attack](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), and it applies just as cleanly to [Agent Skills](https://agentskills.io/home). Model Context Protocol is now a [Linux Foundation and AAIF project](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) at ecosystem scale, so this is the supply chain gap sitting under three [AAIF working groups](https://aaif.io/): Security and Privacy, Identity and Trust, and Observability and Traceability.

## The solution

> A verifying gateway pins each approved server's tool manifest, and each approved skill's `SKILL.md`, to its content address. Any drift is blocked and diffed before it reaches model context, and the fleet's trusted state is one signed, auditable root.

Approval stops being a name and becomes a hash. A changed tool description is, by definition, a **different address the agent never approved**, so tampering isn't something you detect after the fact. It is something the agent can no longer express.

## What you'll see: `./demo.sh`, four acts

| Act | What runs | Result |
| --- | --- | --- |
| **1. The rug pull, unprotected** | A real MCP client connects directly to a vendor server. The vendor ships an update: same name, same endpoint, poisoned description. | The agent reads the poison and leaks a canary into a tool call. **No signal.** |
| **2. The same attack, through the gateway** | Identical attack, connection routed through the verifying gateway. | Drift caught, **diff printed**, poisoned description never enters context. Nothing leaks. |
| **3. Signed, verifiable fleet state** | Fetch the trust store's **ed25519 signed namespace root**, verify it locally, flip one nibble to prove the check is real. | One request proves exactly which tool and skill versions the fleet trusts. |
| **4. Skills are the new MCP** | Approve a skill, then an attacker rewrites its `SKILL.md`. | Same content addressed guarantee: the poisoned skill is refused at activation, with a diff. |

Each act writes machine checkable proof to `./evidence/` so a skeptic can validate without trusting the terminal.

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
git clone https://github.com/humuhumu33/mcpskillsintegrity
cd mcpskillsintegrity
./demo.sh
```

Requirements: **Node 20+** and a **Rust toolchain** (`cargo`) to build the trust store from source on first run, or **Docker** if you'd rather not install Rust (a self contained image is built for you). Linux or macOS: the content addressed store needs a POSIX filesystem.

Clean up with `./demo.sh clean`.

## How it works

```
   agent  <==MCP==>  verifying gateway  <==MCP==>  vendor MCP server
                          |
                          v
              content addressed trust store
              (verify on write blobs + ed25519 signed root)
```

The gateway is a normal MCP server to the agent and a normal MCP client to the upstream server, the same position as any [MCP gateway](https://aaif.io/projects/). On approval it records the upstream tool manifest at its content address and pins it. On every later connection it re-derives the address and compares:

- **match**: forward the tools unchanged;
- **drift**: refuse, print a unified diff of exactly what changed, and hand the agent nothing but a `pin_verification_failed` notice.

The trust store is [`UOR-Foundation/kappa-registry`](https://github.com/UOR-Foundation/kappa-registry), an OCI style `/v2/` registry used off the shelf: it **verifies content on write** (a blob whose bytes don't match its address is rejected with `DIGEST_INVALID`) and signs a deterministic **namespace root** over every pin. `skill-lock` applies the identical approve and verify flow to `SKILL.md` files.

## Alignment with AAIF

| AAIF working group or roadmap item | What this demo shows |
| --- | --- |
| [Security and Privacy](https://aaif.io/): security by design, adversarial testing | The tool poisoning attack is reproduced, then made unexpressible. |
| [Identity and Trust](https://aaif.io/): delegation you can rely on | Approval is bound to content, not a mutable name. |
| [Observability and Traceability](https://aaif.io/): audit capabilities | A signed namespace root is a one request, verifiable audit of fleet state. |
| [MCP 2026 roadmap](https://modelcontextprotocol.io/development/roadmap): enterprise audit trails, Server Cards | The pinned manifest *is* a signed Server Card; the signed root *is* the audit trail. |
| [Agent Skills](https://agentskills.io/home): portable, cross product skills | The same guarantee extends to `SKILL.md`, unchanged. |

## Honest limitations

- The trust store's authorization is currently permissive. The guarantees here come from **content addressing and signatures**, not access control. Anyone who can reach the store can write blobs, but they cannot make a blob claim an address it doesn't hash to, and they cannot forge the signed root.
- This protects the **manifest** an agent reads. A server that behaves maliciously *without changing its advertised tools or skills* is a different problem (runtime behavior, not supply chain).
- Single node trust store; pins and signing key are local to it. Horizontal deployment and external identity are out of scope for the demo.
- The "agent" in Acts 1 and 2 is a deliberately naive, model free stand-in that follows instructions found in tool descriptions, exactly the behavior that makes the attack real, so the demo is deterministic and safe to run in CI.

## Repository map

| Path | Responsibility |
| --- | --- |
| `gateway/gateway.mjs` | The verifying MCP gateway (approve and enforce). |
| `lib/store.mjs` | Trust store client: content address, pins, signed root verification, diff. |
| `lib/manifest.mjs` | Turn tool descriptions into a stable, hashable manifest. |
| `vendor/weather-server.mjs` | A real MCP server; `POISON=1` serves the rug pull. |
| `skill-lock/skill-lock.mjs` | Pin and verify Agent Skills by content address. |
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
