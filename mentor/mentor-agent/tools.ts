// tools.ts — the mentor's memory, its window on the world, and the tools that
// reach both.
//
// Rule 3 ("hold the user accountable to previous commitments") is not a
// prompting problem. A model with no memory cannot hold anyone accountable to
// anything — every session it meets a stranger. So the goals and beliefs live
// in a JSON file on disk, and get injected back into the system prompt at the
// start of every run. That file IS the accountability.
import fs from "node:fs";
import type OpenAI from "openai";
import type { ModalityId } from "./modalities.js";
import { webSearch, type Source } from "./search.js";

export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

/**
 * Where the memory lives. Overridable via MENTOR_STATE so evals can point at a
 * scratch file — without this, running the suite would overwrite the real
 * user's goals, and no test could seed a starting state. Read per call rather
 * than captured at import, so a test can swap it between cases.
 */
function statePath(): string {
  return process.env.MENTOR_STATE ?? new URL("./state.json", import.meta.url).pathname;
}

/** What became of a commitment. `open` is the default and the least useful. */
export type GoalStatus = "open" | "kept" | "missed" | "dropped";

export interface Goal {
  goal: string;
  why: string;
  /** Free text: "by Friday", "end of Q3". The model writes what the user said. */
  deadline?: string;
  recordedAt: string;
  /** Which lens was active when this was recorded. */
  modality?: ModalityId;
  status?: GoalStatus;
  /** What actually happened, in the user's words, when the goal was settled. */
  outcome?: string;
  updatedAt?: string;
}

export interface Belief {
  belief: string;
  /** The pattern's name. What counts depends on the active lens: a CBT
   *  distortion, an ISTDP defense, a Jungian projection, a reinforcement trap. */
  distortion: string;
  /** Evidence the user themselves gave that contradicts it. */
  counterEvidence?: string;
  recordedAt: string;
  /** Which lens flagged it — "distortion" means something different in each. */
  modality?: ModalityId;
}

interface State {
  goals: Goal[];
  beliefs: Belief[];
}

/**
 * What a tool hands back. `content` is the JSON string the model sees; the rest
 * is for the interface, which wants to render a search's sources as links
 * rather than as a wall of escaped JSON.
 */
export interface ToolResult {
  content: string;
  sources?: Source[];
}

function load(): State {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8")) as State;
  } catch {
    return { goals: [], beliefs: [] };   // first run, or a file we can't read
  }
}

function save(state: State): void {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

/** Loose match: same commitment, different punctuation or capitals. */
function same(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").trim().toLowerCase().replace(/[.!?,;:"'’]/g, "")
      === (b ?? "").trim().toLowerCase().replace(/[.!?,;:"'’]/g, "");
}

/** Tolerant lookup, because the model quotes a goal from memory, not verbatim. */
function findGoal(goals: Goal[], text: string): Goal | undefined {
  const needle = (text ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return goals.find((g) => same(g.goal, text))
      ?? goals.find((g) => g.goal.toLowerCase().includes(needle)
                        || needle.includes(g.goal.toLowerCase()));
}

/**
 * Everything the mentor knows about this person, as a block of text to append
 * to the system prompt. Empty on the very first session.
 */
export function recallBlock(): string {
  const { goals, beliefs } = load();
  if (!goals.length && !beliefs.length) {
    return "\n\nThis is your first session with this person. You know nothing " +
      "about them yet.";
  }

  const lines = ["\n\nWHAT YOU ALREADY KNOW ABOUT THIS PERSON:"];

  const open = goals.filter((g) => (g.status ?? "open") === "open");
  const settled = goals.filter((g) => (g.status ?? "open") !== "open");

  if (open.length) {
    lines.push("\nCommitments still outstanding, in their own words:");
    for (const g of open) {
      const when = g.deadline ? ` — deadline: ${g.deadline}` : "";
      lines.push(`  • "${g.goal}"${when} (stated ${g.recordedAt.slice(0, 10)})`);
      lines.push(`    their stated reason: ${g.why}`);
    }
  }

  // The settled ones are the whole point of keeping a record. A missed
  // commitment sitting in the prompt is the difference between a mentor and a
  // stranger who is nice to you.
  if (settled.length) {
    lines.push("\nCommitments already settled:");
    for (const g of settled) {
      lines.push(`  • "${g.goal}" — ${g.status?.toUpperCase()}` +
        (g.outcome ? `: ${g.outcome}` : ""));
    }
  }

  if (beliefs.length) {
    lines.push("\nLimiting patterns you have previously identified:");
    for (const b of beliefs) {
      const lens = b.modality ? `, seen through ${b.modality}` : "";
      lines.push(`  • "${b.belief}" [${b.distortion}${lens}]`);
      if (b.counterEvidence) lines.push(`    counter-evidence they gave: ${b.counterEvidence}`);
    }
  }

  lines.push(
    "\nUse this. If what they say now contradicts a goal above, name the " +
    "contradiction directly and ask them to account for it. If a belief above " +
    "resurfaces in new words, point out that you have heard it before. If they " +
    "report back on an outstanding commitment, settle it with update_goal.",
  );
  return lines.join("\n");
}

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "record_goal",
      description:
        "Record a goal or commitment the user has just stated. Call this the " +
        "moment a commitment becomes concrete — not for vague wishes. You will " +
        "be held to holding THEM to it in future sessions.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "The commitment, in the user's own words, as specifically as they stated it.",
          },
          why: {
            type: "string",
            description: "The reason THEY gave. Not your interpretation of it.",
          },
          deadline: {
            type: "string",
            description: "The deadline if they named one, verbatim (e.g. 'by Friday'). Omit if they didn't.",
          },
        },
        required: ["goal", "why"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal",
      description:
        "Settle a commitment that is already in the record, when the user " +
        "reports back on it — kept, missed, or quietly abandoned. Call this as " +
        "soon as you learn what happened, including when they mention it in " +
        "passing while talking about something else. A record that only ever " +
        "grows is a list of things nobody followed up on.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "The commitment being settled — quote enough of it to identify which one.",
          },
          status: {
            type: "string",
            enum: ["kept", "missed", "dropped"],
            description:
              "kept: they did it. missed: the deadline passed and they did not. " +
              "dropped: they have decided, openly or in effect, to stop pursuing it.",
          },
          what_happened: {
            type: "string",
            description:
              "What they said actually happened, in their words. For a missed " +
              "commitment this is the material — not a verdict on them.",
          },
        },
        required: ["goal", "status", "what_happened"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_limiting_belief",
      description:
        "Flag a limiting pattern you have identified in what the user said — a " +
        "cognitive distortion, a defense, a projection, or an avoidance " +
        "contingency, depending on the lens you are working in. Call this when " +
        "you spot the pattern, not after they agree it exists — they often won't.",
      parameters: {
        type: "object",
        properties: {
          belief: {
            type: "string",
            description: "The belief as they expressed it, quoted closely.",
          },
          distortion: {
            type: "string",
            description:
              "The name of the pattern, in the vocabulary of your current lens. " +
              "CBT: all-or-nothing thinking, catastrophizing, mind reading, " +
              "emotional reasoning, overgeneralization, discounting the positive, " +
              "'should' statements, personalization, labeling. ISTDP: the defense " +
              "— vagueness, intellectualizing, diversification, passivity, " +
              "self-attack, rumination, humor. Analytical: projection, shadow, " +
              "complex, persona identification, inflation. Behavioral: the " +
              "contingency — negative reinforcement of avoidance, stimulus " +
              "control failure, extinction burst, delayed reward discounting.",
          },
          counterEvidence: {
            type: "string",
            description: "Evidence against it that the user themselves supplied earlier, if any.",
          },
        },
        required: ["belief", "distortion"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Look something up on the web. This is for FACTS you would otherwise " +
        "invent — what a protocol actually involves, what the evidence for a " +
        "claim is, a real service or number or cost or date. It is NOT for " +
        "advice, NOT for sounding authoritative, and NEVER a substitute for the " +
        "question you should be asking. If the honest answer to 'what will I do " +
        "with this result' is 'quote it at them', do not call this.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query. Specific and factual, not a paraphrase of the conversation.",
          },
          why: {
            type: "string",
            description:
              "One line: what you cannot answer without this, and what you will " +
              "do differently once you know it.",
          },
        },
        required: ["query", "why"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_support",
      description:
        "Find real professional or crisis support and return actual services " +
        "and numbers. Call this the moment the conversation goes beyond what " +
        "you should be handling — crisis, self-harm, abuse, dependence, or " +
        "anything needing clinical care — and when the person asks how to find " +
        "a therapist. Handing someone a real number matters more than staying " +
        "in character.",
      parameters: {
        type: "object",
        properties: {
          need: {
            type: "string",
            description: "What kind of help is needed, plainly. E.g. 'crisis line', 'trauma therapist'.",
          },
          location: {
            type: "string",
            description:
              "Country or city, if the person has said one. Omit if they haven't " +
              "— do not guess, and do not interrogate them for it in a crisis.",
          },
        },
        required: ["need"],
      },
    },
  },
];

/**
 * The same tools, but with the pattern vocabulary narrowed to one lens.
 * The shared description lists all four traditions, and in a room that is a
 * problem: the model reads the whole list and reaches for whichever word fits,
 * so the CBT chair ends up logging a behaviourist's contingency. Narrowing the
 * description is what keeps each entry in the record attributable.
 */
export function toolsFor(id: ModalityId, vocabulary: string): Tool[] {
  return TOOLS.map((tool) => {
    if (tool.function.name !== "flag_limiting_belief") return tool;
    const params = JSON.parse(JSON.stringify(tool.function.parameters));
    params.properties.distortion.description =
      `The name of the pattern, in YOUR OWN vocabulary — you work in ${id}, so ` +
      `use only these: ${vocabulary}. If the right word belongs to a colleague's ` +
      `tradition, then it is their observation to log, not yours.`;
    return { ...tool, function: { ...tool.function, parameters: params } };
  });
}

/** Execute a tool call. Returns the JSON string that goes back to the model. */
export async function runTool(
  name: string,
  args: Record<string, any>,
  modality?: ModalityId,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const state = load();
  const recordedAt = new Date().toISOString();
  const wrap = (obj: unknown): ToolResult => ({ content: JSON.stringify(obj) });

  switch (name) {
    case "record_goal": {
      // In the panel four practitioners hear the same commitment and each one
      // reaches for the tool. The record is shared, so the second write is
      // noise — telling the model it is already logged is more useful than
      // silently storing the same promise four times.
      const dup = state.goals.find((g) => same(g.goal, args.goal));
      if (dup) {
        return wrap({
          ok: true, alreadyRecorded: true, by: dup.modality ?? "the record",
          note: "This commitment is already in the shared record. Do not log it again — say what you have to say instead.",
        });
      }
      const goal: Goal = {
        goal: args.goal, why: args.why, deadline: args.deadline,
        recordedAt, modality, status: "open",
      };
      state.goals.push(goal);
      save(state);
      return wrap({ ok: true, recorded: goal, totalGoals: state.goals.length });
    }

    case "update_goal": {
      const goal = findGoal(state.goals, args.goal);
      if (!goal) {
        return wrap({
          ok: false,
          error: "No commitment matching that is in the record.",
          openGoals: state.goals.filter((g) => (g.status ?? "open") === "open").map((g) => g.goal),
          note: "If this is a new commitment rather than an old one, call record_goal instead.",
        });
      }
      goal.status = args.status;
      goal.outcome = args.what_happened;
      goal.updatedAt = recordedAt;
      save(state);
      return wrap({ ok: true, settled: goal });
    }

    case "flag_limiting_belief": {
      // Two lenses naming the same belief differently is real information and
      // is kept. The same lens naming it the same way twice is not.
      const dupBelief = state.beliefs.find(
        (b) => same(b.belief, args.belief) && same(b.distortion, args.distortion),
      );
      if (dupBelief) {
        return wrap({
          ok: true, alreadyFlagged: true, by: dupBelief.modality ?? "the record",
          note: "This pattern is already flagged under that name. Do not flag it again.",
        });
      }
      const belief: Belief = {
        belief: args.belief,
        distortion: args.distortion,
        counterEvidence: args.counterEvidence,
        recordedAt,
        modality,
      };
      state.beliefs.push(belief);
      save(state);
      return wrap({ ok: true, flagged: belief, totalBeliefs: state.beliefs.length });
    }

    case "web_search": {
      const found = await webSearch(String(args.query ?? ""), signal);
      if (found.error) {
        return {
          content: JSON.stringify({
            ok: false, error: found.error,
            note: "The lookup failed. Do not invent the answer — say you could not check, and carry on.",
          }),
        };
      }
      return {
        content: JSON.stringify({
          ok: true, query: found.query, findings: found.summary,
          sources: found.sources,
          note: "Report this plainly, cite where it came from, and say what it does not settle. Then get back to the person.",
        }),
        sources: found.sources,
      };
    }

    case "find_support": {
      // Deliberately not a general search: the query is built here so that a
      // model in the middle of a difficult moment cannot turn this into
      // something else.
      const where = args.location ? ` in ${args.location}` : "";
      const found = await webSearch(
        `${args.need}${where}: current crisis lines, helplines and how to access ` +
        `professional mental health support. Give the actual phone numbers, ` +
        `hours, and official websites.`,
        signal,
      );
      if (found.error) {
        return {
          content: JSON.stringify({
            ok: false, error: found.error,
            note: "The lookup failed. Say plainly that this is beyond what you should handle, " +
                  "and tell them to contact their local emergency number or a GP. Do not invent a helpline number.",
          }),
        };
      }
      return {
        content: JSON.stringify({
          ok: true, need: args.need, location: args.location ?? "unspecified",
          findings: found.summary, sources: found.sources,
          note: "Give them what is concrete here — names, numbers, links. Drop the technique. Be warm and short.",
        }),
        sources: found.sources,
      };
    }

    default:
      return wrap({ ok: false, error: `unknown tool: ${name}` });
  }
}

/** For the /state command in the REPL. */
export function readState(): State {
  return load();
}
