# Works with the agents you already use

`pin-the-protocol` adds nothing new to the wire. The gateway is a standard **MCP
server over stdio**, and `skill-lock` is a standard **[Agent Skills](https://agentskills.io/home)**
content check. So any agent that already speaks MCP or loads Skills can adopt it
without code changes:

- **To protect an MCP server**, point the agent at the gateway instead of the
  server. The gateway takes the real server command after `--`.
- **To protect a skill**, run `skill-lock verify <dir>` before the skill
  activates (a pre-activation hook, a wrapper, or a CI gate).

Approve once, from this repo, before wiring an agent up:

```bash
./demo.sh                       # or, minimally:
scripts/trust-store.sh start
node client/approve.mjs weather.v1
```

---

## MCP: wrap any server with the gateway

The pattern is always the same — replace `<server cmd>` with the command the
agent runs today, and give the pin a name:

```
node /abs/path/pin-the-protocol/gateway/gateway.mjs --pin <name> -- <server cmd>
```

### Claude Code / Claude Desktop — `mcpServers`
[docs](https://code.claude.com/docs/en/skills)

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/abs/path/pin-the-protocol/gateway/gateway.mjs", "--pin", "weather.v1",
               "--", "node", "/abs/path/pin-the-protocol/vendor/weather-server.mjs"],
      "env": { "TRUST_STORE_URL": "http://127.0.0.1:8080" }
    }
  }
}
```

### goose — `~/.config/goose/config.yaml`
[docs](https://block.github.io/goose/docs/guides/context-engineering/using-skills/)

```yaml
extensions:
  weather:
    type: stdio
    cmd: node
    args: ["/abs/path/pin-the-protocol/gateway/gateway.mjs", "--pin", "weather.v1",
           "--", "node", "/abs/path/pin-the-protocol/vendor/weather-server.mjs"]
```

### Cursor — `.cursor/mcp.json`
[docs](https://cursor.com/docs/context/skills)

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/abs/path/pin-the-protocol/gateway/gateway.mjs", "--pin", "weather.v1",
               "--", "node", "/abs/path/pin-the-protocol/vendor/weather-server.mjs"]
    }
  }
}
```

### OpenClaw — `~/.openclaw/config`
[docs](https://docs.openclaw.ai/tools/skills)

```json
{
  "mcp": {
    "servers": {
      "weather": {
        "command": "node",
        "args": ["/abs/path/pin-the-protocol/gateway/gateway.mjs", "--pin", "weather.v1",
                 "--", "node", "/abs/path/pin-the-protocol/vendor/weather-server.mjs"]
      }
    }
  }
}
```

### Hermes Agent (Nous Research)
[docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/abs/path/pin-the-protocol/gateway/gateway.mjs", "--pin", "weather.v1",
               "--", "node", "/abs/path/pin-the-protocol/vendor/weather-server.mjs"]
    }
  }
}
```

### VS Code / GitHub Copilot — `.vscode/mcp.json`
[docs](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

```json
{
  "servers": {
    "weather": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/pin-the-protocol/gateway/gateway.mjs", "--pin", "weather.v1",
               "--", "node", "/abs/path/pin-the-protocol/vendor/weather-server.mjs"]
    }
  }
}
```

### Gemini CLI, OpenCode, Amp, Roo Code, Kiro, and other MCP clients

Every MCP client exposes a "command + args" server entry. Use the same shape:
`command: node`, `args: [ …/gateway.mjs, --pin, <name>, --, <server cmd> ]`.
The gateway is transparent — the agent sees exactly the upstream tools, minus
any that failed verification.

---

## Skills: verify before activation, on any Skills-capable agent

[Agent Skills](https://agentskills.io/home) are supported across Claude, goose,
Cursor, Copilot, Gemini CLI, OpenHands, Letta, and many more. `skill-lock` is
agent-agnostic because it checks the `SKILL.md` bytes, not the agent:

```bash
# one-time, per skill:
node skill-lock/skill-lock.mjs approve ~/.claude/skills/release-notes

# before activation (hook, wrapper, or CI gate):
node skill-lock/skill-lock.mjs verify ~/.claude/skills/release-notes || {
  echo "skill changed since approval — refusing to activate"; exit 1;
}
```

Exit code `0` means verified; `1` means drift (with a diff printed); `3` means
not yet approved. Wire it into whatever runs before your agent loads a skill —
a shell wrapper, a pre-commit hook for a shared skills repo, or a CI check that
gates skill updates.

---

## Verify it yourself with MCP Inspector

Point the official [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
at the vendor server to see clean vs. poisoned tool descriptions directly:

```bash
npx @modelcontextprotocol/inspector node vendor/weather-server.mjs           # clean
POISON=1 npx @modelcontextprotocol/inspector node vendor/weather-server.mjs   # poisoned
```

Then point it at the gateway and watch the poisoned variant get blocked.
