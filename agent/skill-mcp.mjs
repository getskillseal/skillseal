// An MCP server that lets ANY MCP agent (Claude Code, goose, Cursor, ...) use a
// skill straight from distributed storage, safely.
//
// It exposes one tool, `use_skill`, that fetches a skill by content address from
// the S3-compatible / Filecoin store, verifies provenance and integrity, runs
// it, and returns the result -- or refuses if verification fails. The agent's
// model never sees unverified skill bytes.
//
// Wire it into an agent (see docs/design/agent-uses-skill.md):
//   { "command": "node", "args": ["agent/skill-mcp.mjs"],
//     "env": { "S3_ENDPOINT": "...", "S3_PROVIDER": "filebase", ... } }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAndVerify, executeSkill } from "../lib/skillfetch.mjs";

const server = new McpServer({ name: "skill-from-storage", version: "1.0.0" });

server.registerTool(
  "use_skill",
  {
    description:
      "Fetch an agent skill by its content address from distributed (S3/Filecoin) " +
      "storage, verify its provenance and integrity, run it, and return the result. " +
      "Refuses if the publisher signature or any file hash does not match.",
    inputSchema: {
      address: z.string().describe("skill content address, e.g. sha256:..."),
      publisherKey: z.string().describe("publisher ed25519 public key (hex)"),
      input: z.string().optional().describe("path to a task input file for the skill"),
    },
  },
  async ({ address, publisherKey, input }) => {
    const v = await fetchAndVerify(address, publisherKey);
    if (!v.ok) {
      return { isError: true, content: [{ type: "text", text: `Refused: ${v.reason}. The skill was not run.` }] };
    }
    const taskInput = input || join(v.dir, "examples", "sample.csv");
    const run = executeSkill(v.dir, taskInput);
    rmSync(v.dir, { recursive: true, force: true });
    if (run.status !== 0) {
      return { isError: true, content: [{ type: "text", text: `Skill verified but execution failed: ${run.stderr}` }] };
    }
    const report = [
      `Verified "${v.manifest.name}" v${v.manifest.version} from distributed storage:`,
      ...v.steps.map((s) => `  - ${s}`),
      "",
      "Result:",
      run.stdout,
    ].join("\n");
    return { content: [{ type: "text", text: report }] };
  },
);

// Pasting a token into a chat should work as well as pasting it into a shell.
server.registerTool(
  "install_skill",
  {
    description:
      "Install an agent skill from a one-line token (starts with sk1). Checks the " +
      "token, the publisher's signature and every file before writing anything, then " +
      "installs it as a normal skill folder for the agents on this machine. Refuses " +
      "and writes nothing if any check fails.",
    inputSchema: {
      token: z.string().describe("the install token, starting with sk1"),
      to: z.string().optional().describe("install into this folder instead of the detected agents"),
    },
  },
  async ({ token, to }) => {
    const { install } = await import("../skillx/install.mjs");
    try {
      const r = await install(token, { to });
      const where = r.installed.map((t) => `  ${t.label}: ${t.dest}`).join("\n");
      return {
        content: [{
          type: "text",
          text: [`Installed "${r.name}".`, ...r.steps.map((s) => `  - ${s}`), "", where].join("\n"),
        }],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Refused: ${e.message}. Nothing was written.` }] };
    }
  },
);

await server.connect(new StdioServerTransport());
