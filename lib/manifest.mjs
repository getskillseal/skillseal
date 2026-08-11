// Turn "what an agent reads" into a stable, hashable manifest.
//
// Two surfaces, one shape:
//   - MCP tool descriptions: name + description + input schema per tool.
//   - Agent Skills: the SKILL.md text (name + description + instructions).
//
// The manifest is canonical JSON (sorted keys), so identical content always
// yields identical bytes and therefore an identical content address.

import { canonicalJson } from "./store.mjs";

// Build a manifest from an MCP tools/list result.
export function toolManifest(serverName, tools) {
  const normalized = tools
    .map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    kind: "mcp-tools",
    server: serverName,
    tools: normalized,
  };
}

export function manifestBytes(manifest) {
  return Buffer.from(canonicalJson(manifest), "utf8");
}

// Render a manifest as human-readable text for the drift diff. This is what a
// reviewer sees when a pin does not match — every line an agent would read.
export function manifestText(manifest) {
  const lines = [`server: ${manifest.server}`, `kind: ${manifest.kind}`, ""];
  for (const t of manifest.tools) {
    lines.push(`tool: ${t.name}`);
    for (const dl of String(t.description).split("\n")) lines.push(`  desc: ${dl}`);
    lines.push(`  schema: ${canonicalJson(t.inputSchema)}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
