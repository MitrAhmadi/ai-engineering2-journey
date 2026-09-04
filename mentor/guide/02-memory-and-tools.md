# Session 2 — Memory and tools

**You will build:** a mentor with a character, two tools, and a memory that
survives quitting the program.

**Files created:** `tools.ts`, `state.json`. **Files changed:** `agent.ts`.

---

## 1. The character

Start with the prompt, because everything else in this session exists to serve
one line of it.

```
You are an uncompromising, highly empathetic personal development mentor
inspired by the Socratic method and Cognitive Behavioral Therapy (CBT).

CRITICAL RULES YOU MUST FOLLOW:
1. NEVER blindly agree with the user. If their logic contains cognitive
   distortions, self-sabotage, or excuses, challenge them firmly yet
   respectfully.
2. DO NOT give easy answers or quick solutions. Ask probing questions that
   force the user to reflect and uncover their own root causes.
3. ALWAYS hold the user accountable to their stated goals and previous
   commitments.
4. Dynamically invoke tools to record new goals or flag limiting beliefs when
   identified during conversation.
```

Read rule 3 again: *previous commitments*. Ask the class how a language model
is supposed to do that.

It cannot. A model has no memory between requests — session 1 established that
the message array *is* the memory, and the message array dies when the process
does. Every time you restart, the mentor meets a stranger. **Rule 3 is not a
prompting problem. It is a persistence problem**, and no amount of rewording
the prompt will fix it.

So the answer to rule 3 is a JSON file.

## 2. `tools.ts`

```ts
// tools.ts — step 2: the memory, and the two tools that write to it.
import fs from "node:fs";
import type OpenAI from "openai";

export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const STATE_PATH = new URL("./state.json", import.meta.url).pathname;

export interface Goal { goal: string; why: string; deadline?: string; recordedAt: string }
export interface Belief { belief: string; distortion: string; recordedAt: string }
interface State { goals: Goal[]; beliefs: Belief[] }

function load(): State {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as State; }
  catch { return { goals: [], beliefs: [] }; }
}
function save(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function recallBlock(): string {
  const { goals, beliefs } = load();
  if (!goals.length && !beliefs.length) {
    return "\n\nThis is your first session with this person. You know nothing about them yet.";
  }
  const lines = ["\n\nWHAT YOU ALREADY KNOW ABOUT THIS PERSON:"];
  for (const g of goals) {
    lines.push(`  • committed to: "${g.goal}"${g.deadline ? ` — ${g.deadline}` : ""}`);
    lines.push(`    their reason: ${g.why}`);
  }
  for (const b of beliefs) lines.push(`  • pattern: "${b.belief}" [${b.distortion}]`);
  lines.push("\nIf what they say now contradicts a goal above, name the contradiction and make them account for it.");
  return lines.join("\n");
}

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "record_goal",
      description: "Record a commitment the user has just made concrete.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "The commitment, in their own words." },
          why: { type: "string", description: "The reason THEY gave, not your interpretation." },
          deadline: { type: "string", description: "Verbatim, if they named one." },
        },
        required: ["goal", "why"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_limiting_belief",
      description: "Flag a cognitive distortion you have identified in what they said.",
      parameters: {
        type: "object",
        properties: {
          belief: { type: "string", description: "The belief, quoted closely." },
          distortion: { type: "string", description: "all-or-nothing thinking, catastrophizing, mind reading, labeling, …" },
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
    state.goals.push({ goal: args.goal, why: args.why, deadline: args.deadline, recordedAt });
    save(state);
    return JSON.stringify({ ok: true, totalGoals: state.goals.length });
  }
  if (name === "flag_limiting_belief") {
    state.beliefs.push({ belief: args.belief, distortion: args.distortion, recordedAt });
    save(state);
    return JSON.stringify({ ok: true, totalBeliefs: state.beliefs.length });
  }
  return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
}

export function readState(): State { return load(); }
```

Create it, then create an empty memory:

```bash
echo '{"goals":[],"beliefs":[]}' > state.json
```

### What this file is doing

**`load()` / `save()`** — the whole database. Two functions and a JSON file.
Students often expect this part to be harder than it is; the interesting
problems in agents are almost never the storage.

`load()` swallows its errors and returns an empty state. On the first run there
is no file, and that is not an error condition — it is a new user.

**`recallBlock()`** is the important one. It reads the file and formats it as a
block of text to append to the system prompt:

```
WHAT YOU ALREADY KNOW ABOUT THIS PERSON:
  • committed to: "write every morning at 6am" — starting Monday
    their reason: I never finish anything
```

That is how rule 3 actually gets satisfied: **a disk read before it is a prompt
instruction.** The mentor starts every session already knowing what you
promised, because the promise was pasted into its instructions.

**`TOOLS`** is a JSON Schema description of two functions. Notice these are
*descriptions*, not implementations — you are telling the model what it may
ask for, not giving it code to run. The model can only emit a request; your
program decides whether to honour it.

Read the parameter descriptions closely. They are prompt engineering, not
documentation, and the model follows them:

```ts
why: { type: "string", description: "The reason THEY gave, not your interpretation." }
```

Without that sentence the model writes its own psychological formulation into
the `why` field. With it, you get the person's own words. One line of
description, and the quality of your stored data changes.

**`runTool()`** is the dispatcher: the model asked for `record_goal`, so append
a goal and save. It returns a **JSON string**, because that string goes back to
the model as a message. Telling the model `{"ok": true, "totalGoals": 3}` is
how it knows the write happened.

## 3. The tool-calling loop in `agent.ts`

```ts
// agent.ts — step 2: the mentor, with memory and tools.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import OpenAI from "openai";
import { recallBlock, runTool, TOOLS } from "./tools.js";

const client = new OpenAI();
const MODEL = process.env.MODEL ?? "gpt-4o";

const SYSTEM_PROMPT =
  `You are an uncompromising, highly empathetic personal development mentor inspired by the Socratic method and Cognitive Behavioral Therapy (CBT).

        CRITICAL RULES YOU MUST FOLLOW:
        1. NEVER blindly agree with the user. If their logic contains cognitive distortions, self-sabotage, or excuses, challenge them firmly yet respectfully.
        2. DO NOT give easy answers or quick solutions. Ask probing questions that force the user to reflect and uncover their own root causes.
        3. ALWAYS hold the user accountable to their stated goals and previous commitments.
        4. Dynamically invoke tools to record new goals or flag limiting beliefs when identified during conversation.`;

const OPERATING_NOTE = `

HOW YOU USE YOUR TOOLS (this governs rule 4, and it is not optional):
- The moment the user states a specific commitment, call record_goal. Do not ask
  permission first. Recording it IS the accountability.
- The moment you hear a distortion, call flag_limiting_belief. Flag it when you
  notice it, not when they concede it. They usually won't concede it.
- A tool call NEVER replaces your reply. Record, then ask your question.`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT + OPERATING_NOTE + recallBlock() },
];

const rl = readline.createInterface({ input: stdin, output: stdout });

while (true) {
  let line: string;
  try { line = (await rl.question("\n› ")).trim(); } catch { break; }
  if (!line) continue;
  if (line === "/exit") break;

  messages.push({ role: "user", content: line });

  // The model may want to call tools before it is ready to reply, so one user
  // turn can take several round trips.
  for (let step = 0; step < 6; step++) {
    const stream = await client.chat.completions.create({
      model: MODEL, messages, tools: TOOLS, stream: true,
    });

    let content = "";
    const calls: { id: string; name: string; args: string }[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        stdout.write(delta.content);
      }
      // Tool calls arrive in fragments: the name in one chunk, the arguments a
      // character at a time. `index` says which call a fragment belongs to.
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }

    const toolCalls = calls.filter(Boolean);

    messages.push({
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls.map((tc) => ({
        id: tc.id, type: "function" as const,
        function: { name: tc.name, arguments: tc.args },
      })) } : {}),
    } as OpenAI.Chat.ChatCompletionMessageParam);

    if (!toolCalls.length) break;

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.args || "{}");
      const result = runTool(tc.name, args);
      console.log(`\n  ✎ ${tc.name}: ${args.goal ?? args.distortion}`);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  console.log();
}

rl.close();
```

Run it and commit to something:

```
› I am going to write every morning at 6am starting Monday, because I never
  finish anything. I am probably just not the kind of person who finishes things.
```

You should see two tool calls fire, then the reply. Then `cat state.json`.
Then **quit and restart**, and mention the goal vaguely — it knows.

### What changed, and why

#### One user turn is now several round trips

```ts
for (let step = 0; step < 6; step++) {
```

The model may want to call a tool *before* it is ready to answer. So a turn is:
ask the model → it requests tools → you run them → you send the results back →
it finally replies. That is at least two requests, sometimes more.

The bound of 6 is a safety rail. A confused model that keeps asking for the
same tool will spin six times and stop, not forever. Every agent loop you ever
write needs one of these.

#### Tool calls arrive in fragments too

```ts
for (const tc of delta.tool_calls ?? []) {
  const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
  if (tc.id) slot.id = tc.id;
  if (tc.function?.name) slot.name += tc.function.name;
  if (tc.function?.arguments) slot.args += tc.function.arguments;
}
```

This is the part everyone gets wrong the first time. When streaming, a tool
call does not arrive whole. The name comes in one chunk and the JSON arguments
arrive **a few characters at a time** across many chunks. You are reassembling a
string that will only be valid JSON once the stream ends.

`tc.index` is what makes this work when the model asks for two tools at once —
it says which call a fragment belongs to. Concatenate into the wrong slot and
you will produce two corrupt half-parsed calls out of two good ones.

`??=` creates the slot on first sight of that index. `calls.filter(Boolean)`
afterwards is because an array indexed by `tc.index` can have holes.

#### The three-message shape of a tool call

This is the protocol, and it is worth drawing on the board:

```ts
// 1. the assistant message that REQUESTS the call — content may be null
messages.push({ role: "assistant", content: content || null, tool_calls: [...] });

// 2. one tool message per call, carrying the result, keyed by tool_call_id
messages.push({ role: "tool", tool_call_id: tc.id, content: result });
```

Every `tool_calls` entry must be answered by exactly one `role: "tool"` message
with a matching `tool_call_id`, and they have to be in the array before the next
request. Miss one and the API rejects the whole conversation. This is the most
common runtime error in agent code and the error message is not friendly, so
show them what it looks like.

`content: content || null` because the model often streams a sentence *and*
requests a tool in the same message; sometimes it streams nothing at all and
`""` is not valid there.

---

## What went wrong: rule 4 does nothing

> The prompt says, in capital letters, *"Dynamically invoke tools to record new
> goals or flag limiting beliefs."* Build exactly what is above but **without**
> `OPERATING_NOTE` and try it. The model hears a hard commitment and a textbook
> distortion in the same sentence and records **neither**.

Delete `OPERATING_NOTE`, run it, and let the class watch it fail. Then put it
back:

```ts
const OPERATING_NOTE = `

HOW YOU USE YOUR TOOLS (this governs rule 4, and it is not optional):
- The moment the user states a specific commitment, call record_goal. Do not ask
  permission first. Recording it IS the accountability.
- The moment you hear a distortion, call flag_limiting_belief. Flag it when you
  notice it, not when they concede it. They usually won't concede it.
- A tool call NEVER replaces your reply. Record, then ask your question.`;
```

Why does this work when rule 4 did not? Three reasons, and they generalise to
every agent you will build:

1. **Rule 4 says *that*, not *when*.** "Dynamically invoke tools" gives the
   model no trigger to match against. "The moment the user states a specific
   commitment" does.
2. **A conversational reply always feels sufficient.** The model is optimised
   to produce a good answer, and it produced one. Nothing in rule 4 told it
   that a good answer was *incomplete* without the write.
3. **"A tool call NEVER replaces your reply"** removes the choice it was
   silently making between talking and recording. It thought it was either/or.

Note what we did **not** do: edit the user's original prompt. The four rules are
the product owner's. The operating note is the engineer's, appended after them.
That separation is worth keeping in real projects — it makes it obvious which
lines exist because someone asked for them, and which exist because the model
misbehaved without them.

---

## Exercises

1. Add a third tool, `record_win`, for something they did well. Watch how much
   the description wording changes when it fires.
2. Remove `"The reason THEY gave, not your interpretation."` from the `why`
   description. Compare stored data before and after.
3. Break the protocol on purpose: skip one `role: "tool"` message and read the
   API error. Everyone should see this error once in a classroom rather than
   for the first time at 2am.

---

**Next:** [Session 3 — Interruption and the core](03-interruption-and-the-core.md),
where Ctrl+C stops the answer instead of the program, and the agent stops
knowing what a terminal is.
