# Session 5 — Reaching outside the conversation

**You will build:** live web search with real sources, a tool that settles
commitments instead of only collecting them, and a route out of the app for
when it stops being the right room.

**Files created:** `search.ts`. **Files changed:** `tools.ts`, `mentor.ts`,
`agent.ts`.

---

## Three tools, one theme

Everything the agent has done so far is generated from what it already knows.
This session adds the only place a fact can enter from outside, and the only
place a record can be *closed*.

| tool | why it exists |
|---|---|
| `web_search` | so the agent stops inventing facts |
| `find_support` | so the safety boundary is an action, not a disclaimer |
| `update_goal` | so the record settles instead of only growing |

Start with the third, because it is the smallest and it fixes a real hole.

## 1. `update_goal` — a record that only grows is a list nobody read

Right now `state.json` accumulates commitments and never closes one. The mentor
can hold you to a promise but can never learn that you kept it. So:

```ts
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
        goal: { type: "string", description: "The commitment being settled — quote enough of it to identify which one." },
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
```

`enum` in a JSON Schema is a real constraint, not a hint — you get one of three
strings back, so `state.json` stays queryable.

The lookup is deliberately sloppy, because the model quotes a goal from memory
rather than byte-for-byte:

```ts
function findGoal(goals: Goal[], text: string): Goal | undefined {
  const needle = (text ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  return goals.find((g) => same(g.goal, text))
      ?? goals.find((g) => g.goal.toLowerCase().includes(needle)
                        || needle.includes(g.goal.toLowerCase()));
}
```

Exact match first, then containment either way. And when nothing matches, the
failure is **useful**:

```ts
return wrap({
  ok: false,
  error: "No commitment matching that is in the record.",
  openGoals: state.goals.filter((g) => (g.status ?? "open") === "open").map((g) => g.goal),
  note: "If this is a new commitment rather than an old one, call record_goal instead.",
});
```

This is a principle worth stating: **a tool error is a message to a reader who
can act on it.** Hand back the list it should have chosen from and tell it what
to do instead, and it recovers on the next step of the same turn. Return
`{"ok": false}` alone and it either gives up or invents.

`recallBlock()` then splits the record in two, which is what makes the whole
thing worth doing:

```ts
const open = goals.filter((g) => (g.status ?? "open") === "open");
const settled = goals.filter((g) => (g.status ?? "open") !== "open");
```

A missed commitment sitting in the system prompt is the difference between a
mentor and a stranger who is nice to you.

## 2. `search.ts` — the window on the world

```ts
// search.ts — the mentor's only window onto the world outside the conversation.
//
// Everything else this agent does is generated from what it already knows. This
// file is the one place a fact can enter from outside, which is exactly why it
// is deliberately narrow: it answers a question and returns sources, and it
// never decides anything.
//
// It runs on the Responses API's hosted web_search tool, so there is no second
// API key and no scraper to maintain — the same OPENAI_API_KEY that runs the
// conversation runs the search.
import OpenAI from "openai";

// Constructed on first use, not at import. A module that throws merely because
// it was imported cannot be loaded by a test, a type checker, or a tool that
// only wants one exported constant out of it.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

/** Search is a lookup, not a conversation. It does not need the big model. */
export const SEARCH_MODEL = process.env.SEARCH_MODEL ?? "gpt-4o-mini";

export interface Source {
  title: string;
  url: string;
}

export interface SearchResult {
  query: string;
  summary: string;
  sources: Source[];
  /** Set when the lookup failed. Failure is data, not an exception. */
  error?: string;
}

// Four practitioners in one room will reach for the same fact within seconds of
// each other. The cache is per-process and unbounded on purpose: a session is
// short, and paying twice for the same query inside one conversation is silly.
const cache = new Map<string, SearchResult>();

/** OpenAI folds citations into the prose as ([domain](url)). We show sources
 *  separately, so leaving them inline just makes the text unreadable. */
function stripInlineCitations(text: string): string {
  return text
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}

export async function webSearch(query: string, signal?: AbortSignal): Promise<SearchResult> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await client().responses.create(
      {
        model: SEARCH_MODEL,
        tools: [{ type: "web_search_preview" }],
        tool_choice: { type: "web_search_preview" },
        input:
          `${query}\n\nAnswer in at most four sentences. State plainly what the ` +
          `evidence does and does not show. If the sources disagree, say so ` +
          `rather than picking a side. Do not give advice.`,
      },
      { signal },
    );

    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const item of res.output ?? []) {
      for (const part of (item as any).content ?? []) {
        for (const ann of part.annotations ?? []) {
          if (ann.type !== "url_citation" || seen.has(ann.url)) continue;
          seen.add(ann.url);
          sources.push({ title: ann.title ?? new URL(ann.url).hostname, url: ann.url });
        }
      }
    }

    const result: SearchResult = {
      query,
      summary: stripInlineCitations(res.output_text ?? ""),
      sources: sources.slice(0, 5),
    };
    cache.set(key, result);
    return result;
  } catch (err) {
    // A failed lookup must not end the turn. The model is told the search
    // failed and carries on with the conversation, which is what a person
    // would do when a search box times out.
    return {
      query,
      summary: "",
      sources: [],
      error: (err as Error).message ?? "the search failed",
    };
  }
}
```

### What to point out

**A different API.** Everything so far used Chat Completions. This uses the
**Responses API**, because web search there is *hosted* — OpenAI runs the
search and the fetching. No second provider, no API key to sign up for, no
scraper to keep alive.

```ts
tools: [{ type: "web_search_preview" }],
tool_choice: { type: "web_search_preview" },
```

`tool_choice` forces it. Without it the model will sometimes answer from
memory, which is the exact failure we added this file to prevent.

**Two kinds of tool, and it is worth being explicit in class.** `record_goal` is
*your* function: the model asks, your code runs. `web_search_preview` is a
*hosted* tool: the provider runs it inside their own loop and you never see the
request. Same word, completely different mechanics.

**Citations are structured data.** The prose comes back with citations folded
in as `([domain](url))`, and there is a parallel `annotations` array:

```ts
for (const ann of part.annotations ?? []) {
  if (ann.type !== "url_citation" || seen.has(ann.url)) continue;
  seen.add(ann.url);
  sources.push({ title: ann.title ?? new URL(ann.url).hostname, url: ann.url });
}
```

We pull those out, deduplicate, and strip the inline versions from the prose,
because we are going to render sources as links rather than as parenthetical
noise.

**Failure is data, not an exception.**

```ts
} catch (err) {
  return { query, summary: "", sources: [], error: (err as Error).message ?? "the search failed" };
}
```

A search timing out must not end the turn. The model is told the lookup failed
and carries on — which is what a person does when a search box hangs. Nothing
in this project throws where it could return.

**The cache** is per-process and unbounded, which would be wrong in a
long-running service and is right here: in session 7 four practitioners will
reach for the same fact within seconds, and a session is short.

## 3. Wiring an async tool

`webSearch` returns a promise, so `runTool` has to become async — and that
ripples exactly two lines into each core:

```ts
export async function runTool(
  name: string,
  args: Record<string, any>,
  modality?: ModalityId,
  signal?: AbortSignal,
): Promise<ToolResult> {
```

Note the `signal`. It comes from the same `AbortController` as the model
request, so **Ctrl+C cancels a search in flight too.** Cancellation that only
covers some of your I/O is not cancellation.

The return type changes from `string` to:

```ts
export interface ToolResult {
  content: string;        // the JSON string the MODEL sees
  sources?: Source[];     // structured data the INTERFACE renders
}
```

Two audiences, two shapes, one call. In `mentor.ts`:

```ts
const result = await runTool(tc.name, args, this.modalityId, controller.signal);
const event: ToolEvent = {
  name: tc.name, args, label: toolLabel(tc.name, args),
  ...(result.sources?.length ? { sources: result.sources } : {}),
};
fired.push(event);
handlers.onTool?.(event);
this.messages.push({ role: "tool", tool_call_id: tc.id, content: result.content });
```

## 4. The prompt is the hard part, not the plumbing

The plumbing above is twenty minutes' work. The design question is: **when
should a Socratic mentor look something up?**

Mostly, it should not. The whole character is *"do not give easy answers, ask
probing questions"*. An agent that reaches for a search engine mid-session is
usually avoiding the harder move. So the tool is fenced, in its own description:

```
This is for FACTS you would otherwise invent — what a protocol actually
involves, what the evidence for a claim is, a real service or number or cost or
date. It is NOT for advice, NOT for sounding authoritative, and NEVER a
substitute for the question you should be asking. If the honest answer to 'what
will I do with this result' is 'quote it at them', do not call this.
```

and again in `OPERATING_NOTE`, with the positive cases spelled out:

```
Search when:
- the whole conversation rests on a factual claim they have asserted and you
  do not actually know whether it holds;
- a specific figure, protocol or finding would change what they do next, and
  making one up would be worse than saying nothing;
- they need something real in the world, which is what find_support is for.
THE CASE YOU WILL MISS: they state a research claim as established fact and
build a conclusion on it — "studies show", "it's settled science", "they've
proven". Check it. Conceding a false claim and challenging a true one are both
failures... Naming the distortion in how they used the claim is not a substitute
for knowing whether the claim is true.
Do not search to sound authoritative... Never hand someone a reading list
instead of the question you owe them.
```

and the pre-reply checklist from session 4 grows a third item:

```
  3. Did they assert a research or factual claim and lean their conclusion on
     it? → call web_search now. Item 2 does not discharge item 3: naming how
     they used a claim is not the same as knowing whether it is true.
```

> **What went wrong — and how we know.** The first two of those three additions
> are not how this was originally written. The original said only "the whole
> conversation rests on a factual claim they have asserted", and when an eval
> was later pointed at exactly that case — *"willpower is a finite resource,
> it's settled science, so people like me are doomed after 6pm"* — the search
> fired **zero times out of three**. The mentor flagged the distortion and moved
> on. The abstract trigger lost to the vivid prohibitions around it. Naming the
> case concretely and adding the checklist item took it to 4/4, with the
> "must not search" cases still at 4/4. See [`mentor-evals/`](../mentor-evals/README.md).

There is also a required `why` parameter on the tool:

```ts
why: {
  type: "string",
  description: "One line: what you cannot answer without this, and what you will do differently once you know it.",
}
```

The value is never used by the code. Making the model **state its justification
as part of the call** is a cheap and surprisingly effective way to suppress
calls that have no justification. This is a general technique worth naming in
class.

### It works

Given: *"I read that willpower is a finite resource that gets used up during the
day, so people like me are basically doomed by the evening"* — the mentor
flagged the catastrophizing, searched, came back with a PubMed source, and said:

> *"...some studies have questioned the existence of the ego-depletion
> phenomenon, meaning the evidence isn't entirely conclusive. Reflecting on your
> own experience, you successfully ran three times last week, which counters the
> idea that you're 'doomed' by the evening."*

Memory and search doing one job together: the fact came from the web, the
counter-evidence came from `state.json`.

## 5. `find_support` — the boundary, made real

Every stance carries `SAFETY`: not a therapist, never diagnose, hand over to a
professional when it matters. Until now that produced a *sentence*. This makes
it produce a phone number.

```ts
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
```

Read the comment aloud in class. The model supplies `need` and `location`; **the
model does not supply the query.** That is a security posture as much as a
product one — narrow the tool so a compromised or confused caller cannot
repurpose it. Compare with `web_search`, where the model writes the query
freely, and ask the class why the two are treated differently.

Note also what the failure path says:

```
"Say plainly that this is beyond what you should handle, and tell them to
contact their local emergency number or a GP. Do not invent a helpline number."
```

A hallucinated crisis line is the worst output this application could produce.

Asked for a therapist in Berlin, it returned the real Berliner Krisendienst
number and hours.

## 6. Showing the sources

An unsourced claim is what we added this session to avoid, so the terminal
prints them:

```ts
onTool: (event) => {
  const mark = event.name === "web_search" || event.name === "find_support" ? "⌕" : "✎";
  stdout.write(`${started ? "\n" : ""}${c.amber(`  ${mark} ${event.label}`)}\n`);
  for (const src of event.sources ?? []) {
    stdout.write(c.dim(`      ${src.title.slice(0, 62)}\n      ${src.url}\n`));
  }
  started = false;
},
```

## 7. The complete `tools.ts`

```ts
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
```

---

## Exercises

1. Swap the hosted search for Tavily or Brave. Only `search.ts` should change —
   if anything else does, the seam was in the wrong place.
2. Give the cache a TTL and a size cap. Argue about whether this app needs it.
3. Delete the `why` parameter and count spurious searches over ten turns.
4. Add `record_win`, and have `recallBlock()` surface a kept goal the next time
   the person says they never finish anything.

---

**Next:** [Session 6 — The browser](06-the-browser.md), where the core you have
been careful with gets imported by a web server without a single edit.
