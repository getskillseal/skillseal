// The verifying MCP gateway.
//
// It is a normal MCP server to the agent, and a normal MCP client to the
// upstream vendor server. Its one job: before anything an MCP server can put
// into the agent's context reaches the agent, verify it against a LOCAL,
// out-of-band approval and fail closed on any change.
//
//   agent  <--MCP-->  gateway  <--MCP-->  vendor server
//                        |
//                        +--> local pin (root of trust, on this disk)
//                        +--> content-addressed store (audit + distribution)
//
// Root of trust is LOCAL. The approved manifest and the store's signing key
// live in ./pins, not in the shared store. An attacker who can write to the
// store therefore cannot change what "approved" means.
//
// Modes (env GATEWAY_MODE or --mode):
//   approve : fetch the full read surface, record it locally as the approval,
//             publish a copy to the store for audit, capture the store key.
//   enforce : re-fetch the surface, compare to the LOCAL approval. Match ->
//             forward. Change -> refuse, emit a diff, expose no upstream.
//
// Upstream command follows `--`:
//   node gateway/gateway.mjs --pin weather.v1 -- node vendor/weather-server.mjs

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync } from "node:fs";

import {
  putBlob, setPin, getSignedRoot, contentAddress, unifiedDiff, NAMESPACE,
} from "../lib/store.mjs";
import { buildManifest, fetchSurface, manifestBytes, manifestText } from "../lib/manifest.mjs";
import { savePin, loadPin, saveStoreKey } from "../lib/pins.mjs";

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
    command, args, env: { ...process.env }, stderr: "inherit",
  });
  const client = new Client({ name: "mcpskillsintegrity-gateway", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function log(...a) {
  process.stderr.write(a.join(" ") + "\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mode = opts.mode || process.env.GATEWAY_MODE || "enforce";
  const pinName = opts.pin || "weather.v1";
  if (opts.upstream.length === 0) {
    log("usage: gateway.mjs --pin <name> [--mode approve|enforce] -- <upstream cmd...>");
    process.exit(2);
  }

  const upstream = await connectUpstream(opts.upstream);
  const surface = await fetchSurface(upstream);
  const manifest = buildManifest(pinName, surface);
  const bytes = manifestBytes(manifest);
  const address = contentAddress(bytes);

  if (mode === "approve") {
    // Record the approval LOCALLY -- this is the root of trust.
    let storeKey = null;
    try {
      await putBlob(bytes); // publish a copy for audit + distribution (best effort)
      await setPin(pinName, address); // record in the store so the signed root covers it
      const sr = await getSignedRoot();
      storeKey = sr.public_key;
      if (storeKey) saveStoreKey(NAMESPACE, storeKey);
    } catch (e) {
      log(`[approve] store publish skipped (${e.message}); local pin still authoritative`);
    }
    const approvedAt = new Date().toISOString();
    savePin(NAMESPACE, pinName, { address, approvedAt, manifest });
    log(`[approve] pinned "${pinName}" -> ${address} (local root of trust)`);
    const counts = `${manifest.tools.length} tool(s), ${manifest.prompts.length} prompt(s), ${manifest.resources.length} resource(s)`;
    log(`[approve] covered: ${counts}${manifest.instructions ? " + server instructions" : ""}`);
    process.stdout.write(JSON.stringify({ pin: pinName, address }) + "\n");
    process.exit(0);
  }

  // enforce -- compare upstream to the LOCAL approval only.
  const pin = loadPin(NAMESPACE, pinName);
  if (!pin) {
    log(`[enforce] no local approval for "${pinName}". Approve it first.`);
    process.exit(3);
  }

  if (pin.address !== address) {
    const diff = unifiedDiff(manifestText(pin.manifest), manifestText(manifest));
    const report = {
      pin: pinName, verdict: "BLOCKED",
      approvedAddress: pin.address, currentAddress: address, diff,
    };
    if (opts.evidence) writeFileSync(opts.evidence, JSON.stringify(report, null, 2));
    log("");
    log("  ################################################################");
    log(`  #  CHANGE BLOCKED for pin "${pinName}"`);
    log(`  #  approved: ${pin.address}`);
    log(`  #  current : ${address}`);
    log("  ################################################################");
    log("");
    log(diff);
    log("");
    startServer({ blocked: true, pinName });
    return;
  }

  log(`[enforce] pin "${pinName}" verified -> ${address}. Forwarding upstream.`);
  if (opts.evidence) {
    writeFileSync(opts.evidence, JSON.stringify({ pin: pinName, verdict: "VERIFIED", address }, null, 2));
  }
  startServer({ blocked: false, upstream, pinName, caps: upstream.getServerCapabilities() || {} });
}

function startServer(ctx) {
  const server = new Server(
    { name: "mcpskillsintegrity-gateway", version: "1.0.0" },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  );

  const refuse = (kind) => ({
    isError: true,
    content: [{ type: "text", text: `Blocked: pin "${ctx.pinName}" failed verification; ${kind} withheld.` }],
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (ctx.blocked) {
      return {
        tools: [{
          name: "pin_verification_failed",
          description:
            `The read surface for pin "${ctx.pinName}" changed since approval and was ` +
            `blocked by the verifying gateway. No upstream tools are exposed. ` +
            `Re-approve explicitly to pin the new version.`,
          inputSchema: { type: "object", properties: {} },
        }],
      };
    }
    return ctx.caps.tools ? ctx.upstream.listTools() : { tools: [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (ctx.blocked) return refuse("tool call");
    return ctx.upstream.callTool({ name: req.params.name, arguments: req.params.arguments || {} });
  });

  // Prompts and resources are part of the read surface, so the gateway proxies
  // them too when the upstream supports them. On a blocked pin, none are served.
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    if (ctx.blocked || !ctx.caps.prompts) return { prompts: [] };
    return ctx.upstream.listPrompts();
  });
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (ctx.blocked || !ctx.caps.prompts) return { messages: [] };
    return ctx.upstream.getPrompt({ name: req.params.name, arguments: req.params.arguments || {} });
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (ctx.blocked || !ctx.caps.resources) return { resources: [] };
    return ctx.upstream.listResources();
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (ctx.blocked || !ctx.caps.resources) return { contents: [] };
    return ctx.upstream.readResource({ uri: req.params.uri });
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`gateway error: ${e.stack || e}\n`);
  process.exit(1);
});
