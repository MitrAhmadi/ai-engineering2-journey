// Writes the agent's live prompt + tool schemas to contract.json so the Python
// eval harness exercises exactly what agent.ts ships. Run: pnpm eval:contract
import fs from "node:fs";
import { OPERATING_NOTE, SYSTEM_PROMPT } from "../prompts";
import { FIRST_SESSION_RECALL, TOOLS } from "../tools";

const contract = {
  // Evals always run against a blank memory so results are reproducible.
  system: SYSTEM_PROMPT + OPERATING_NOTE + FIRST_SESSION_RECALL,
  tools: TOOLS,
};

const out = new URL("./contract.json", import.meta.url).pathname;
fs.writeFileSync(out, JSON.stringify(contract, null, 2));
console.log(`wrote ${out}`);
