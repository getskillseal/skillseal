// Drive the use_skill MCP tool exactly as a real MCP agent would: connect over
// stdio, list tools, call use_skill with a skill address + publisher key, and
// print the returned result. Proves the tool works over the MCP wire, no model
// required for the transport test.
//
//   node agent/mcp-client-test.mjs <address> <publisherKey>

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [address, publisherKey] = process.argv.slice(2);
if (!address || !publisherKey) {
  console.error("usage: mcp-client-test.mjs <address> <publisherKey>");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["agent/skill-mcp.mjs"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "mcp-agent", version: "1.0.0" });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log(`agent connected. tools offered: ${tools.join(", ")}`);

const res = await client.callTool({ name: "use_skill", arguments: { address, publisherKey } });
await client.close();

const text = (res.content || []).map((c) => c.text).join("\n");
console.log("\n--- use_skill returned ---");
console.log(text);
console.log(`\nisError: ${res.isError === true}`);
process.exit(res.isError ? 1 : 0);
