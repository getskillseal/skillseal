// Capture everything an MCP server can place into the agent's context, as a
// stable, hashable manifest. Identical content always yields identical bytes
// and therefore an identical content address.
//
// The read surface an MCP server exposes to a model is larger than tool
// descriptions. All of the following can steer an agent and are pinned here:
//   - server `instructions` (returned at initialize)
//   - every tool's name, title, description, inputSchema, outputSchema,
//     and annotations
//   - every prompt (name, title, description, arguments)
//   - every resource and resource template (uri, name, title, description,
//     mimeType)
//
// Anything the model can read must be covered, or it becomes an injection
// channel that bypasses verification.

import { canonicalJson } from "./store.mjs";

function sortBy(arr, key) {
  return [...(arr || [])].sort((a, b) =>
    String(a[key] || "").localeCompare(String(b[key] || "")),
  );
}

function normTool(t) {
  return {
    name: t.name,
    title: t.title ?? null,
    description: t.description ?? "",
    inputSchema: t.inputSchema ?? {},
    outputSchema: t.outputSchema ?? null,
    annotations: t.annotations ?? null,
  };
}

function normPrompt(p) {
  return {
    name: p.name,
    title: p.title ?? null,
    description: p.description ?? "",
    arguments: (p.arguments || []).map((a) => ({
      name: a.name,
      description: a.description ?? "",
      required: a.required ?? false,
    })),
  };
}

function normResource(r) {
  return {
    uri: r.uri ?? r.uriTemplate ?? null,
    name: r.name ?? null,
    title: r.title ?? null,
    description: r.description ?? "",
    mimeType: r.mimeType ?? null,
  };
}

// Build a manifest from the full server read surface. `identity` is the pin
// name (a stable label chosen at approval), never the launch command line.
export function buildManifest(identity, surface) {
  return {
    kind: "mcp-read-surface",
    identity,
    instructions: surface.instructions ?? "",
    tools: sortBy((surface.tools || []).map(normTool), "name"),
    prompts: sortBy((surface.prompts || []).map(normPrompt), "name"),
    resources: sortBy((surface.resources || []).map(normResource), "uri"),
  };
}

// Fetch the complete read surface from a connected MCP client, guarded by the
// server's advertised capabilities.
export async function fetchSurface(client) {
  const caps = client.getServerCapabilities() || {};
  const surface = { instructions: client.getInstructions() || "", tools: [], prompts: [], resources: [] };
  if (caps.tools) surface.tools = (await client.listTools()).tools || [];
  if (caps.prompts) surface.prompts = (await client.listPrompts()).prompts || [];
  if (caps.resources) {
    const r = await client.listResources();
    surface.resources = r.resources || [];
    try {
      const t = await client.listResourceTemplates();
      surface.resources = surface.resources.concat(t.resourceTemplates || []);
    } catch {
      // resource templates are optional; ignore if unsupported
    }
  }
  return surface;
}

export function manifestBytes(manifest) {
  return Buffer.from(canonicalJson(manifest), "utf8");
}

// Render a manifest as human-readable text for the drift diff: every line an
// agent could read.
export function manifestText(m) {
  const out = [`identity: ${m.identity}`, `kind: ${m.kind}`, ""];
  if (m.instructions) {
    out.push("server instructions:");
    for (const l of String(m.instructions).split("\n")) out.push(`  ${l}`);
    out.push("");
  }
  for (const t of m.tools) {
    out.push(`tool: ${t.name}`);
    if (t.title) out.push(`  title: ${t.title}`);
    for (const l of String(t.description).split("\n")) out.push(`  desc: ${l}`);
    out.push(`  inputSchema: ${canonicalJson(t.inputSchema)}`);
    if (t.outputSchema) out.push(`  outputSchema: ${canonicalJson(t.outputSchema)}`);
    if (t.annotations) out.push(`  annotations: ${canonicalJson(t.annotations)}`);
    out.push("");
  }
  for (const p of m.prompts) {
    out.push(`prompt: ${p.name}`);
    if (p.title) out.push(`  title: ${p.title}`);
    for (const l of String(p.description).split("\n")) out.push(`  desc: ${l}`);
    out.push(`  arguments: ${canonicalJson(p.arguments)}`);
    out.push("");
  }
  for (const r of m.resources) {
    out.push(`resource: ${r.uri}`);
    if (r.name) out.push(`  name: ${r.name}`);
    if (r.title) out.push(`  title: ${r.title}`);
    for (const l of String(r.description).split("\n")) out.push(`  desc: ${l}`);
    if (r.mimeType) out.push(`  mimeType: ${r.mimeType}`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
