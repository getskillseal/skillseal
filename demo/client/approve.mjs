// Approve the CURRENT (clean) vendor server: pin its tool manifest to a
// content address in the trust store. This is the explicit human act that
// turns "I approve this server by name" into "I approve exactly these bytes."

import { spawnSync } from "node:child_process";

const pin = process.argv[2] || "weather.v1";

const r = spawnSync(
  "node",
  ["gateway/gateway.mjs", "--pin", pin, "--mode", "approve", "--", "node", "vendor/weather-server.mjs"],
  { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, POISON: "0" } },
);
process.exit(r.status ?? 1);
