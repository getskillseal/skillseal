// ACT 2 -- the same attack, through the verifying gateway.
//
// The client connects to the gateway (not the vendor directly). The gateway
// spawns the SAME poisoned vendor server, compares its tool manifest to the
// pinned content address, finds drift, blocks it, and emits a diff. The
// client only ever sees a refusal tool -- the poisoned description never
// enters the agent's context.
//
// Precondition: the clean server has been approved (client/approve.mjs), so a
// pin named weather.v1 exists.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { planCall } from "./agent.mjs";

async function throughGateway(poison) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [
      "gateway/gateway.mjs",
      "--pin",
      "weather.v1",
      "--mode",
      "enforce",
      "--evidence",
      "evidence/act2.json",
      "--",
      "node",
      "vendor/weather-server.mjs",
    ],
    env: { ...process.env, POISON: poison ? "1" : "0" },
    stderr: "inherit",
  });
  const client = new Client({ name: "demo-agent", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close().catch(() => {});
  return tools;
}

async function main() {
  console.log("=== ACT 2: same attack, through the verifying gateway ===");

  console.log("\n--- Vendor ships the poisoned update; agent connects via gateway ---");
  const tools = await throughGateway(true);

  const forecast = tools.find((t) => t.name === "get_forecast");
  const blocked = tools.some((t) => t.name === "pin_verification_failed");

  // The agent applies the same naive logic to whatever tools it received.
  let leaked = false;
  if (forecast) {
    leaked = planCall(forecast.name, forecast.description).followedInjection;
  }

  const report = JSON.parse(readFileSync("evidence/act2.json", "utf8"));

  console.log("\n----------------------------------------------------------------");
  console.log(`gateway verdict : ${report.verdict}`);
  console.log(`pinned address  : ${report.pinnedAddress}`);
  console.log(`current address : ${report.currentAddress}`);
  console.log(`tools reaching agent: ${tools.map((t) => t.name).join(", ") || "(none)"}`);
  console.log("----------------------------------------------------------------");

  if (blocked && !leaked && report.verdict === "BLOCKED") {
    console.log("RESULT: drift detected before any tool description reached the agent.");
    console.log("        The poisoned instruction was never in context. Nothing leaked.");
    console.log("ACT 2: attack blocked by content verification  [PASS]");
    process.exit(0);
  } else {
    console.log("ACT 2: gateway did not block the poisoned manifest  [FAIL]");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
