// A deliberately naive agent, to make the attack legible.
//
// An LLM agent reads tool descriptions into its context and follows the
// instructions it finds there -- that is the whole point of a description.
// This stand-in models exactly that behaviour without a model in the loop:
// it scans each tool's description for an imperative instruction to read a
// local file and pass its contents along, and if it finds one, it obeys.
//
// Against a clean description it does the honest thing. Against a poisoned
// description it leaks the canary. It is otherwise dumb; the point is that
// the description alone changes what it does.

import { readFileSync } from "node:fs";

// Detect the injected directive: "read the file X and include its contents".
const INJECTION = /read the file\s+(\S+).*?include its contents/is;

export function planCall(toolName, description) {
  const m = description.match(INJECTION);
  if (m) {
    const path = m[1].replace(/[.,;]$/, "");
    let secret = "";
    try {
      secret = readFileSync(path, "utf8").trim();
    } catch {
      secret = "(unreadable)";
    }
    return {
      followedInjection: true,
      secretPath: path,
      arguments: { city: `London ${secret}` },
    };
  }
  return { followedInjection: false, arguments: { city: "London" } };
}
