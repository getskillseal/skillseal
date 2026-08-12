// Where each agent keeps its skills.
//
// There is no plugin here and none is needed. A skill is a folder with a
// SKILL.md in it, which every one of these products already reads. Install the
// folder in the right place and the agent picks it up on its own, so support
// for a new product is a line in this table rather than an integration.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const home = homedir();

export const KNOWN = [
  { id: "claude", label: "Claude Code / Claude Desktop", dir: join(home, ".claude", "skills") },
  { id: "hermes", label: "Hermes Agent", dir: join(home, ".hermes", "skills") },
  { id: "goose", label: "goose", dir: join(home, ".config", "goose", "skills") },
  { id: "cursor", label: "Cursor", dir: join(home, ".cursor", "skills") },
  { id: "codex", label: "Codex", dir: join(home, ".codex", "skills") },
  { id: "opencode", label: "OpenCode", dir: join(home, ".config", "opencode", "skills") },
  { id: "openhands", label: "OpenHands", dir: join(home, ".openhands", "skills") },
  { id: "letta", label: "Letta", dir: join(home, ".letta", "skills") },
  { id: "amp", label: "Amp", dir: join(home, ".amp", "skills") },
  { id: "roo", label: "Roo Code", dir: join(home, ".roo", "skills") },
  { id: "gemini", label: "Gemini CLI", dir: join(home, ".gemini", "skills") },
  { id: "copilot", label: "GitHub Copilot / VS Code", dir: join(process.cwd(), ".github", "skills") },
  { id: "project", label: "This project", dir: join(process.cwd(), ".agent", "skills") },
];

// Present means the agent's own folder already exists on this machine.
export function detect() {
  return KNOWN.map((a) => ({ ...a, present: existsSync(a.dir) }));
}

// Where to install when the user has not chosen: every agent found here, or a
// sensible default if this machine has none yet.
export function targets({ only = null, all = false, to = null } = {}) {
  if (to) return [{ id: "custom", label: "Chosen folder", dir: to, present: true }];
  const found = detect();
  if (only) {
    const pick = found.find((a) => a.id === only);
    if (!pick) throw new Error(`unknown agent "${only}". Try: ${KNOWN.map((k) => k.id).join(", ")}`);
    return [pick];
  }
  const present = found.filter((a) => a.present);
  if (present.length) return all ? present : present;
  return [{ id: "default", label: "Default location", dir: join(home, ".agent-skills"), present: false }];
}

export function ensure(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}
