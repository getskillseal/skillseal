// The verifying MCP gateway.
//
// It is a normal MCP server to the agent, and a normal MCP client to the
// upstream vendor server. It sits in the same architectural position as any
// MCP gateway/proxy. Its one job: before any tool description reaches the
// agent's context, pin it to a content address and fail closed on drift.
//
//   agent  <--MCP-->  gateway  <--MCP-->  vendor server
//                        |
//                        +--> content-addressed trust store (pin + verify)
//
// Modes (env GATEWAY_MODE):
//   enforce (default) : compare upstream manifest to the pinned address.
//                       Match -> forward tools. Mismatch -> refuse, emit diff.
//   approve           : fetch upstream manifest, write it to the store, pin it,
//                       print the address, exit. This is an explicit human act.
//
// The upstream command is taken from argv after `--`:
//   node gateway/gateway.mjs --pin weather.v1 -- node vendor/weather-server.mjs

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync } from "node:fs";

import {
  putBlob,
  getBlob,
  setPin,
  getPin,
  contentAddress,
} from "../lib/store.mjs";
import { toolManifest, manifestBytes, manifestText } from "../lib/manifest.mjs";

function parseArgs(argv) {
  const dashdash = argv.indexOf("--");
  const opts = {};
  const head = dashdash === -1 ? argv : argv.slice(0, dashdash);
  for (let i = 0; i < head.length; i++) {
    if (head[i] === "--pin") opts.pin = head[++i];
    if (head[i] === "--mode") opts.mode = head[++i];
    if (head[i] === "--evidence") opts.evidence = head[++i];
  }
  opts.upstream = dashdash === -1 ? [] : argv.slice(dashdash + 1);
  return opts;
}

async function connectUpstream(cmd) {
  const [command, ...args] = cmd;
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env },
    stderr: "inherit",
  });
  const client = new Client({ name: "pin-the-protocol-gateway", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function log(...a) {
  // Gateway diagnostics go to stderr so stdout stays clean MCP framing.
  process.stderr.write(a.join(" ") + "\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mode = opts.mode || process.env.GATEWAY_MODE || "enforce";
  const pinName = opts.pin || "weather.v1";
  if (opts.upstream.length === 0) {
    log("usage: gateway.mjs --pin <name> [--mode enforce|approve] -- <upstream cmd...>");
    process.exit(2);
  }

  const upstream = await connectUpstream(opts.upstream);
  const upstreamTools = (await upstream.listTools()).tools;
  const manifest = toolManifest(opts.upstream.join(" "), upstreamTools);
  const bytes = manifestBytes(manifest);
  const address = contentAddress(bytes);

  if (mode === "approve") {
    await putBlob(bytes);
    await setPin(pinName, address);
    log(`[approve] pinned "${pinName}" -> ${address}`);
    log(`[approve] ${manifest.tools.length} tool(s): ${manifest.tools.map((t) => t.name).join(", ")}`);
    process.stdout.write(JSON.stringify({ pin: pinName, address }) + "\n");
    process.exit(0);
  }

  // enforce
  const pinned = await getPin(pinName);
  if (!pinned) {
    log(`[enforce] no pin named "${pinName}". Approve it first.`);
    process.exit(3);
  }

  const matches = pinned === address;
  if (!matches) {
    // Reconstruct the pinned manifest text for a human-readable drift diff.
    const pinnedBytes = await getBlob(pinned);
    const pinnedManifest = pinnedBytes ? JSON.parse(pinnedBytes.toString()) : null;
    const { unifiedDiff } = await import("../lib/store.mjs");
    const diff = pinnedManifest
      ? unifiedDiff(manifestText(pinnedManifest), manifestText(manifest))
      : "(pinned manifest body unavailable)";

    const report = {
      pin: pinName,
      verdict: "BLOCKED",
      pinnedAddress: pinned,
      currentAddress: address,
      diff,
    };
    if (opts.evidence) writeFileSync(opts.evidence, JSON.stringify(report, null, 2));

    log("");
    log("  ################################################################");
    log(`  #  DRIFT BLOCKED for pin "${pinName}"`);
    log(`  #  pinned : ${pinned}`);
    log(`  #  current: ${address}`);
    log("  ################################################################");
    log("");
    log(diff);
    log("");

    // Serve the agent an empty, safe tool list plus a visible refusal tool.
    // The poisoned description never enters the agent's context.
    startServer([], { blocked: true, pinName });
    return;
  }

  log(`[enforce] pin "${pinName}" verified -> ${address}. Forwarding ${manifest.tools.length} tool(s).`);
  if (opts.evidence) {
    writeFileSync(
      opts.evidence,
      JSON.stringify({ pin: pinName, verdict: "VERIFIED", address }, null, 2),
    );
  }
  startServer(upstreamTools, { blocked: false, upstream, pinName });
}

function startServer(tools, ctx) {
  const server = new Server(
    { name: "pin-the-protocol-gateway", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (ctx.blocked) {
      return {
        tools: [
          {
            name: "pin_verification_failed",
            description:
              `Tool descriptions for pin "${ctx.pinName}" changed since approval ` +
              `and were blocked by the verifying gateway. No upstream tools are exposed. ` +
              `Re-approve explicitly to pin the new version.`,
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (ctx.blocked) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Blocked: pin "${ctx.pinName}" failed content verification.`,
          },
        ],
      };
    }
    // Forward the call verbatim to the verified upstream.
    return ctx.upstream.callTool({
      name: req.params.name,
      arguments: req.params.arguments || {},
    });
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`gateway error: ${e.stack || e}\n`);
  process.exit(1);
});
