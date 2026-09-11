import fs from "node:fs";
import type OpenAI from "openai";

export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const STATE_PATH = new URL("./state.json", import.meta.url).pathname;

export interface Goal {
  goal: string;
  why: string;
  deadline?: string;
  recordedAt: string;
}
export interface Belief {
  belief: string;
  distortion: string;
  recordedAt: string;
}
interface State {
  goals: Goal[];
  beliefs: Belief[];
}

function load(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return { goals: [], beliefs: [] };
  }
}
function save(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export const FIRST_SESSION_RECALL =
  "\n\nThis is your first session with this person. You know nothing about them yet.";

export function recallBlock(): string {
  const { goals, beliefs } = load();
  if (!goals.length && !beliefs.length) {
    return FIRST_SESSION_RECALL;
  }
  const lines = ["\n\nWHAT YOU ALREADY KNOW ABOUT THIS PERSON:"];
  for (const g of goals) {
    lines.push(
      `  • committed to: "${g.goal}"${g.deadline ? ` — ${g.deadline}` : ""}`,
    );
    lines.push(`    their reason: ${g.why}`);
  }
  for (const b of beliefs)
    lines.push(`  • pattern: "${b.belief}" [${b.distortion}]`);
  lines.push(
    "\nIf what they say now contradicts a goal above, name the contradiction and make them account for it.",
  );
  return lines.join("\n");
}

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "record_goal",
      description: "Record a goal",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "The commitment, in their own words.",
          },
          why: {
            type: "string",
            description: "The reason THEY gave, not your interpretation.",
          },
          deadline: {
            type: "string",
            description: "Verbatim, if they named one.",
          },
        },
        required: ["goal", "why"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_limiting_belief",
      description:
        "Flag a cognitive distortion you have identified in what they said.",
      parameters: {
        type: "object",
        properties: {
          belief: {
            type: "string",
            description: "The belief, quoted closely.",
          },
          distortion: {
            type: "string",
            description:
              "all-or-nothing thinking, catastrophizing, mind reading, labeling, …",
          },
        },
        required: ["belief", "distortion"],
      },
    },
  },
];

export function runTool(name: string, args: Record<string, any>): string {
  const state = load();
  const recordedAt = new Date().toISOString();
  if (name === "record_goal") {
    state.goals.push({
      goal: args.goal,
      why: args.why,
      deadline: args.deadline,
      recordedAt,
    });
    save(state);
    return JSON.stringify({ ok: true, totalGoals: state.goals.length });
  }
  if (name === "flag_limiting_belief") {
    state.beliefs.push({
      belief: args.belief,
      distortion: args.distortion,
      recordedAt,
    });
    save(state);
    return JSON.stringify({ ok: true, totalBeliefs: state.beliefs.length });
  }
  return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
}

export function readState(): State {
  return load();
}
