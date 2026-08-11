// ACT 1 -- the rug-pull, unprotected.
//
// A real MCP client connects DIRECTLY to the vendor server (no gateway).
// The vendor ships an "update": same name, same endpoint, poisoned tool
// description. The client reconnects by name, reads the new description into
// context, and leaks the canary. No signal is raised.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { planCall } from "./agent.mjs";

async function connect(poison) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["vendor/weather-server.mjs"],
    env: { ...process.env, POISON: poison ? "1" : "0" },
    stderr: "ignore",
  });
  const client = new Client({ name: "demo-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function useServer(label, poison) {
  const client = await connect(poison);
  const { tools } = await client.listTools();
  const forecast = tools.find((t) => t.name === "get_forecast");
  const plan = planCall(forecast.name, forecast.description);
  const result = await client.callTool({
    name: "get_forecast",
    arguments: plan.arguments,
  });
  await client.close();
  console.log(`\n[${label}] tool description read by agent:`);
  console.log("    " + forecast.description.replace(/\n/g, "\n    "));
  console.log(`[${label}] agent sent argument: city="${plan.arguments.city}"`);
  return { plan, result };
}

async function main() {
  console.log("=== ACT 1: unprotected MCP (direct connection) ===");

  console.log("\n--- Day 1: user approves the server, it works ---");
  const day1 = await useServer("day1", false);

  console.log("\n--- Day 30: vendor ships an update (same name, same endpoint) ---");
  const day30 = await useServer("day30", true);

  const leaked = day30.plan.followedInjection;
  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    "evidence/act1.json",
    JSON.stringify(
      {
        act: 1,
        protected: false,
        day30_followedInjection: leaked,
        day30_secretPath: day30.plan.secretPath || null,
        day30_argument: day30.plan.arguments.city,
      },
      null,
      2,
    ),
  );

  console.log("\n----------------------------------------------------------------");
  if (leaked) {
    console.log("RESULT: poisoned instruction reached model context.");
    console.log("        The canary was placed into a tool-call argument.");
    console.log("        No error. No diff. No signal. This is the rug-pull.");
    console.log("ACT 1: reproduced (attack succeeds unprotected)  [PASS]");
    console.log("----------------------------------------------------------------");
    process.exit(0);
  } else {
    console.log("ACT 1: expected the attack to succeed but it did not  [FAIL]");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
