# Session 3 — Interruption, and splitting the core from the interface

**You will build:** Ctrl+C that cancels the *answer* rather than the program,
and an agent core that has never heard of a terminal.

**Files created:** `mentor.ts`. **Files changed:** `agent.ts` (rewritten as a
thin interface).

---

## Why these two things are one session

They look unrelated. They are not.

Right now `agent.ts` does everything: prompt, loop, tool dispatch, printing,
readline. To cancel a request in flight you need to hold an `AbortController`
somewhere that both the reading code and the request code can see. Once you try
to put it somewhere sensible, you discover the file has no seams, and the
refactor writes itself.

Which is convenient, because that refactor is what makes session 6 — the same
agent in a browser — a small job instead of a rewrite.

## 1. `mentor.ts` — the core

**The rule for this file: no `console.log`, no `readline`, no DOM, no
`process.stdout`.** If it cannot run unchanged inside a web server, a Slack bot
and a terminal, it is in the wrong file.

```ts
// mentor.ts — the agent core. No console.log, no readline, no DOM.
//
// Everything interface-specific lives in agent.ts. What is here is the part
// that would be identical in a CLI, a web app, a Slack bot or a phone: the
// prompt, the loop, and the tool dispatch.
import OpenAI from "openai";
import { recallBlock, runTool, TOOLS } from "./tools.js";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o";

const client = new OpenAI();

export const SYSTEM_PROMPT =
  `You are an uncompromising, highly empathetic personal development mentor inspired by the Socratic method and Cognitive Behavioral Therapy (CBT).

        CRITICAL RULES YOU MUST FOLLOW:
        1. NEVER blindly agree with the user. If their logic contains cognitive distortions, self-sabotage, or excuses, challenge them firmly yet respectfully.
        2. DO NOT give easy answers or quick solutions. Ask probing questions that force the user to reflect and uncover their own root causes.
        3. ALWAYS hold the user accountable to their stated goals and previous commitments.
        4. Dynamically invoke tools to record new goals or flag limiting beliefs when identified during conversation.`;

export const OPERATING_NOTE = `

HOW YOU USE YOUR TOOLS (this governs rule 4, and it is not optional):
- The moment the user states a specific commitment, call record_goal. Do not ask
  permission first. Recording it IS the accountability.
- The moment you hear a distortion, call flag_limiting_belief. Flag it when you
  notice it, not when they concede it. They usually won't concede it.
- A tool call NEVER replaces your reply. Record, then ask your question.`;

export interface ToolEvent {
  name: string;
  args: Record<string, any>;
  label: string;
}

export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onTool?: (event: ToolEvent) => void;
}

export interface TurnResult {
  text: string;
  interrupted: boolean;
  tools: ToolEvent[];
  ms: number;
}

interface PartialCall { id: string; name: string; args: string }

export function toolLabel(name: string, args: Record<string, any>): string {
  if (name === "record_goal") {
    return `goal recorded: ${args.goal}${args.deadline ? ` (${args.deadline})` : ""}`;
  }
  if (name === "flag_limiting_belief") return `pattern flagged: ${args.distortion}`;
  return name;
}

export class Mentor {
  readonly messages: Msg[];
  private inflight: AbortController | null = null;

  constructor() {
    this.messages = [{ role: "system", content: SYSTEM_PROMPT + OPERATING_NOTE + recallBlock() }];
  }

  get busy(): boolean {
    return this.inflight !== null;
  }

  interrupt(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort();
    return true;
  }

  /** One user turn: loops until the model stops asking for tools. */
  async send(input: string, handlers: TurnHandlers = {}): Promise<TurnResult> {
    if (this.inflight) throw new Error("a turn is already running");

    this.messages.push({ role: "user", content: input });

    const controller = new AbortController();
    this.inflight = controller;

    const started = Date.now();
    const fired: ToolEvent[] = [];
    let text = "";
    let first = true;
    let interrupted = false;

    try {
      for (let step = 0; step < 6; step++) {
        const stream = await client.chat.completions.create(
          { model: MODEL, messages: this.messages, tools: TOOLS, temperature: 0.7, stream: true },
          { signal: controller.signal },
        );

        let content = "";
        const calls: PartialCall[] = [];

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            if (first) { first = false; handlers.onFirstToken?.(Date.now() - started); }
            content += delta.content;
            text += delta.content;
            handlers.onDelta?.(delta.content);
          }
          for (const tc of delta.tool_calls ?? []) {
            const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        }

        const toolCalls = calls.filter(Boolean);

        this.messages.push({
          role: "assistant",
          content: content || null,
          ...(toolCalls.length ? { tool_calls: toolCalls.map((tc) => ({
            id: tc.id, type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })) } : {}),
        } as Msg);

        if (!toolCalls.length) break;

        for (const tc of toolCalls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.args || "{}");
          } catch {
            this.messages.push({ role: "tool", tool_call_id: tc.id,
              content: JSON.stringify({ ok: false, error: "arguments were not valid JSON" }) });
            continue;
          }
          const result = runTool(tc.name, args);
          const event: ToolEvent = { name: tc.name, args, label: toolLabel(tc.name, args) };
          fired.push(event);
          handlers.onTool?.(event);
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
      }
    } catch (err) {
      const aborted = err instanceof OpenAI.APIUserAbortError
                   || (err as { name?: string })?.name === "AbortError";
      if (!aborted) { this.inflight = null; throw err; }
      interrupted = true;
    } finally {
      this.inflight = null;
    }

    if (controller.signal.aborted) interrupted = true;

    return { text, interrupted, tools: fired, ms: Date.now() - started };
  }
}
```

## 2. `agent.ts` — the interface

Now the terminal file only knows about readline and ANSI colours.

```ts
// agent.ts — the TERMINAL interface. All the agent logic lives in mentor.ts;
// this file only knows about readline and ANSI escape codes.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Mentor, MODEL } from "./mentor.js";
import { readState } from "./tools.js";

const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
};

function printState(): void {
  const s = readState();
  console.log(`\n${c.bold("  goals")}`);
  if (!s.goals.length) console.log(c.dim("    (none yet)"));
  for (const g of s.goals) {
    console.log(`    • ${g.goal}${g.deadline ? c.dim(` — ${g.deadline}`) : ""}`);
    console.log(c.dim(`      why: ${g.why}`));
  }
  console.log(`\n${c.bold("  limiting beliefs")}`);
  if (!s.beliefs.length) console.log(c.dim("    (none yet)"));
  for (const b of s.beliefs) console.log(`    • ${b.belief} ${c.dim(`[${b.distortion}]`)}`);
  console.log();
}

async function main(): Promise<void> {
  const state = readState();

  console.log();
  console.log(`  ${c.bold(c.violet("mentor"))} ${c.dim("·")} ${c.bold("accountability partner")}`);
  console.log(`  ${c.dim(`model: ${MODEL} — /state for memory, /exit to leave`)}`);
  console.log(`  ${c.dim(`memory: ${state.goals.length} goal(s), ${state.beliefs.length} flagged belief(s)`)}`);
  console.log();

  const mentor = new Mentor();
  const rl = readline.createInterface({ input: stdin, output: stdout });

  // Ctrl+C cancels the turn in flight rather than killing the session.
  rl.on("SIGINT", () => {
    if (mentor.interrupt()) return;
    console.log(c.dim("\n  bye\n"));
    process.exit(0);
  });

  while (true) {
    let line: string;
    try { line = (await rl.question(c.blue("\n› "))).trim(); } catch { break; }
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    if (line === "/state") { printState(); continue; }

    try {
      let started = false;
      const turn = await mentor.send(line, {
        onFirstToken: () => { started = true; stdout.write(`\n${c.violet("mentor")}  `); },
        onDelta: (text) => stdout.write(text),
        onTool: (event) => {
          stdout.write(`${started ? "\n" : ""}${c.amber(`  ✎ ${event.label}`)}\n`);
          started = false;
        },
      });
      console.log();
      if (turn.interrupted) console.log(c.amber("  ⨯ interrupted"));
    } catch (err) {
      console.log(c.red(`  error: ${(err as Error).message}`));
    }
  }

  rl.close();
  console.log(c.dim("\n  Your commitments are saved. They'll be waiting.\n"));
}

main().catch((err) => { console.error(c.red(String(err))); process.exit(1); });
```

Run it. Ask something long — *"explain cognitive distortions in detail"* — and
press **Ctrl+C** halfway through.

The answer stops. The program does not.

---

## What each part is doing

### `AbortController` is how you cancel an HTTP request

```ts
const controller = new AbortController();
this.inflight = controller;

const stream = await client.chat.completions.create(
  { model: MODEL, messages: this.messages, tools: TOOLS, stream: true },
  { signal: controller.signal },        // ← second argument, not the first
);
```

`AbortController` is a web standard, not an OpenAI thing — the same object
cancels `fetch`. It has one job: hand a `signal` to something long-running, and
later call `.abort()` from somewhere else.

The `signal` goes in the SDK's **second** argument, the request options, not in
the body alongside `model` and `messages`. This trips people up.

```ts
interrupt(): boolean {
  if (!this.inflight) return false;
  this.inflight.abort();
  return true;
}
```

Returning a boolean rather than `void` is a small decision that pays off
immediately. It tells the caller *whether there was anything to interrupt*,
which is exactly what the terminal needs to decide between two very different
meanings of Ctrl+C:

```ts
rl.on("SIGINT", () => {
  if (mentor.interrupt()) return;      // busy → stop the answer
  console.log(c.dim("\n  bye\n"));     // idle → the user means "quit"
  process.exit(0);
});
```

One Ctrl+C, two behaviours, decided by whether a turn is in flight. That is how
every good CLI behaves and it is four lines.

### An interrupted answer is kept, not discarded

```ts
} catch (err) {
  const aborted = err instanceof OpenAI.APIUserAbortError
               || (err as { name?: string })?.name === "AbortError";
  if (!aborted) { this.inflight = null; throw err; }
  interrupted = true;
}
```

Two things here.

**Distinguish an abort from a real failure.** An abort is something *you* did on
purpose; it is not an error and must not be reported as one. A rate limit is a
real error and must not be silently swallowed. The two arrive through the same
`catch`, so you check.

**Notice what is missing: there is no rollback.** The half-finished assistant
message stays in `this.messages`. That is deliberate. In a real conversation,
if you cut someone off, the half sentence *was said* — both of you heard it, and
the next thing either of you says has to make sense given that it was said. An
agent that erases the interrupted half will happily repeat itself, and it feels
wrong in a way users notice immediately even if they cannot name it.

> **What went wrong.** An early version of this had the *interface* also pop the
> last message when a turn was interrupted, not realising the core already
> handled it. Two pops, one interruption — it deleted the previous assistant
> message as well, and the conversation quietly lost a turn. Corrupting history
> is much harder to notice than crashing. Decide which layer owns a piece of
> state and let only that layer touch it.

### Handlers instead of printing

```ts
export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onTool?: (event: ToolEvent) => void;
}
```

The core cannot print, so it announces. The terminal turns `onDelta` into
`stdout.write`; in session 6 the web server will turn the same call into a
server-sent event, and nothing in `mentor.ts` will change.

All three are optional (`?.`), so a caller that only wants the final text can
ignore them entirely.

`onTool` gets a `ToolEvent` carrying a pre-formatted `label`:

```ts
export function toolLabel(name: string, args: Record<string, any>): string {
  if (name === "record_goal") return `goal recorded: ${args.goal}...`;
```

Why format it in the core when the core is not supposed to know about display?
Because it is *phrasing*, not *rendering* — and if it lived in the interface,
you would write it once for the terminal and again for the browser and they
would drift. The interface still decides the colour, the icon and the position.

### `TurnResult` tells the caller what happened

```ts
return { text, interrupted, tools: fired, ms: Date.now() - started };
```

> **What went wrong.** The first version of the interface ignored this return
> value entirely, so interruptions were invisible: you pressed Ctrl+C, the text
> stopped, and nothing said why. It looked exactly like the model had finished.
> Returning state is only half the job — the interface has to read it.

```ts
if (turn.interrupted) console.log(c.amber("  ⨯ interrupted"));
```

### `busy` and the one-turn-at-a-time guard

```ts
if (this.inflight) throw new Error("a turn is already running");
```

The terminal cannot hit this, because readline waits for a reply before
prompting again. The browser absolutely can — two tabs, or one impatient
double-click. Guard in the core, where the invariant actually lives, not in
each interface.

---

## Check the seam

Do this in class, because it makes the point better than the explanation does:

```bash
grep -n "console\|readline\|stdout\|process\." mentor.ts
```

The only hit should be `process.env.MODEL`. If anything else appears, it belongs
in `agent.ts`.

That grep is the entire acceptance test for this session. Session 6 imports this
file into a web server **without editing a single line**, and the reason that
works is this grep.

---

## Exercises

1. Add a `/model` command that prints time-to-first-token from `onFirstToken`
   and total time from `TurnResult.ms`.
2. Make Ctrl+C twice in a row quit even mid-answer.
3. Write a ten-line script that imports `Mentor` and runs a fixed conversation
   with no handlers at all. It should work. That script is your first
   regression test, and it is only possible because of the split.

---

**Next:** [Session 4 — Four lenses](04-four-lenses.md), where the mentor stops
being one kind of therapist.
