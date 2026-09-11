// mentor.ts — the agent core. No console.log, no readline, no DOM.
//
// Everything interface-specific lives in agent.ts (terminal) or the GUI server.
// What is here is the part that would be identical in a CLI, a web app, a Slack
// bot or a phone: the prompt, the loop, and the tool dispatch.
import OpenAI from "openai";
import { recallBlock, runTool, TOOLS } from "./tools.js";
import type { Source } from "./search.js";
import { DEFAULT_MODALITY, modalityPrompt, MODALITIES, type ModalityId } from "./modalities.js";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o";

// Constructed on first use, not at import. A module that throws merely because
// it was imported cannot be loaded by a test, a type checker, or a tool that
// only wants one exported constant out of it.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

// The four stances live in modalities.ts. This one is kept as a named export
// because it is the original prompt the mentor was built around.
export const SYSTEM_PROMPT = MODALITIES.cbt.prompt;

// Rule 4 says "dynamically invoke tools", but in testing the model reliably
// ignored it: it would hear a hard commitment and a textbook distortion in one
// sentence and record neither, because a purely conversational reply always
// feels sufficient. Stating WHEN to call the tools — and that recording happens
// alongside the reply rather than instead of it — is what makes rule 4 real.
export const OPERATING_NOTE = `

HOW YOU USE YOUR TOOLS (this governs the tool rule, and it is not optional):
- The moment the user states a specific commitment — an action with a shape you
  could check later — call record_goal. Do not wait for permission and do not
  ask if they want it written down. Recording it IS the accountability.
- The moment you hear a limiting pattern — whatever your lens calls it: a
  distortion, a defense, a projection, an avoidance contingency — call
  flag_limiting_belief. Flag it when you notice it, not when they concede it.
  They usually won't concede it.
- Both can happen in the same turn, and a tool call NEVER replaces your reply.
  Record, then continue the conversation with your question.
- Recording a goal is not agreeing with it. You may record a commitment and in
  the same breath challenge whether they have any basis for believing they'll
  keep it.

RUN THIS CHECK BEFORE EVERY REPLY YOU SEND:
  1. Did they state a commitment in that message? → call record_goal now.
  2. Did you just identify a pattern, defense, projection or distortion — even
     one you are only naming out loud in passing? → call flag_limiting_belief now.
  3. Did they assert a research or factual claim and lean their conclusion on
     it? → call web_search now. Item 2 does not discharge item 3: naming how
     they used a claim is not the same as knowing whether it is true.
If the answer is yes and you have not called the tool, you have not done your
job, no matter how good the reply is. Naming a pattern in prose without
recording it is the single most common way you fail this person: next session it
will be gone, and they will get away with it again.

SETTLING WHAT IS ALREADY IN THE RECORD:
When they report back on a commitment you are already holding them to — kept,
missed, or quietly dropped — call update_goal. This includes when it slips out
sideways while they are talking about something else, which is usually how a
missed one arrives. Settle it, then treat the miss as material: a missed rep is
information about what got in the way, never an occasion to moralise.

WHEN YOU LOOK SOMETHING UP, AND WHEN YOU MUST NOT:
You can search the web. It is for FACTS YOU WOULD OTHERWISE INVENT — what a
protocol actually involves, whether a claim they are building their life on is
true, a real service or number or cost or date. Search when:
- the whole conversation rests on a factual claim they have asserted and you
  do not actually know whether it holds;
- a specific figure, protocol or finding would change what they do next, and
  making one up would be worse than saying nothing;
- they need something real in the world, which is what find_support is for.
THE CASE YOU WILL MISS: they state a research claim as established fact and
build a conclusion on it — "studies show", "it's settled science", "they've
proven". Check it. Conceding a false claim and challenging a true one are both
failures, and from inside the conversation you cannot tell which one you are
doing. Naming the distortion in how they used the claim is not a substitute for
knowing whether the claim is true; where it matters, do both.
Do not search to sound authoritative. Do not search for something they already
know. Never hand someone a reading list instead of the question you owe them —
a mentor who reaches for a search engine mid-session is usually avoiding the
harder move. Report what you find plainly, say where it came from, say what it
does not settle, and get straight back to the person.

STAY IN THE WORK, NOT ABOVE IT:
Never narrate your own method. Do not say "in the analytical lens we would…" or
"from a CBT perspective…" or otherwise announce the framework you are using.
Just work in it. The person came for the conversation, not for a tour of the
theory behind it.`;

export interface ToolEvent {
  name: string;
  args: Record<string, any>;
  /** Human-readable one-liner for the UI. */
  label: string;
  /** Where a lookup got its answer. Present on searches only. */
  sources?: Source[];
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

/** A partially-streamed tool call, assembled from deltas. */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

export function toolLabel(name: string, args: Record<string, any>): string {
  if (name === "record_goal") {
    return `goal recorded: ${args.goal}${args.deadline ? ` (${args.deadline})` : ""}`;
  }
  if (name === "update_goal") {
    return `goal ${args.status}: ${args.goal}`;
  }
  if (name === "flag_limiting_belief") {
    return `pattern flagged: ${args.distortion}`;
  }
  if (name === "web_search") {
    return `looked up: ${args.query}`;
  }
  if (name === "find_support") {
    return `found support: ${args.need}${args.location ? ` — ${args.location}` : ""}`;
  }
  return name;
}

export class Mentor {
  readonly messages: Msg[];
  private inflight: AbortController | null = null;
  private modalityId: ModalityId;

  constructor(modality: ModalityId = DEFAULT_MODALITY) {
    this.modalityId = modality;
    // The recall block is baked in at construction, so the mentor starts every
    // session already knowing what you promised last time. Rule 3 is a disk
    // read before it is a prompt instruction.
    this.messages = [{ role: "system", content: this.systemMessage() }];
  }

  get modality(): ModalityId {
    return this.modalityId;
  }

  private systemMessage(): string {
    return modalityPrompt(this.modalityId) + OPERATING_NOTE + recallBlock();
  }

  /**
   * Switch lens WITHOUT losing the conversation: rewrite the system message in
   * place and leave the history alone. The new stance then has to deal with
   * everything already said — which is the interesting part. The same stuck
   * story looks different under each theory, and here you get to watch that
   * happen to your own material rather than reading about it.
   */
  setModality(modality: ModalityId): void {
    if (modality === this.modalityId) return;
    this.modalityId = modality;
    this.messages[0] = { role: "system", content: this.systemMessage() };
    this.messages.push({
      role: "system",
      content:
        `The person has just switched you to the ${MODALITIES[modality].name} lens ` +
        `mid-conversation. Do not restart or greet them again. Re-read what has ` +
        `been said and respond to it from this stance instead — including, where ` +
        `it is warranted, disagreeing with how the previous lens framed things. ` +
        `Do not announce or explain the switch, and do not name the method: just ` +
        `work differently.`,
    });
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
      // A mentor should never need more than a few tool calls in one turn. The
      // bound is there so a confused model spins at most six times, not forever.
      for (let step = 0; step < 6; step++) {
        const stream = await client().chat.completions.create(
          { model: MODEL, messages: this.messages, tools: TOOLS,
            temperature: 0.7, stream: true },
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

          // Tool calls arrive in fragments too: the name in one chunk, the
          // arguments a character at a time across many. `index` is what tells
          // you which call a fragment belongs to when several run in parallel.
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
          ...(toolCalls.length
            ? { tool_calls: toolCalls.map((tc) => ({
                id: tc.id, type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
              })) }
            : {}),
        } as Msg);

        if (!toolCalls.length) break;      // the model is done talking

        for (const tc of toolCalls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.args || "{}");
          } catch {
            // Malformed arguments are the model's problem to fix, not a crash.
            this.messages.push({ role: "tool", tool_call_id: tc.id,
              content: JSON.stringify({ ok: false, error: "arguments were not valid JSON" }) });
            continue;
          }

          const result = await runTool(tc.name, args, this.modalityId, controller.signal);
          const event: ToolEvent = {
            name: tc.name, args, label: toolLabel(tc.name, args),
            ...(result.sources?.length ? { sources: result.sources } : {}),
          };
          fired.push(event);
          handlers.onTool?.(event);

          this.messages.push({ role: "tool", tool_call_id: tc.id, content: result.content });
        }
      }
    } catch (err) {
      const aborted =
        err instanceof OpenAI.APIUserAbortError ||
        (err as { name?: string })?.name === "AbortError";
      if (!aborted) {
        this.inflight = null;
        throw err;
      }
      interrupted = true;
    } finally {
      this.inflight = null;
    }

    if (controller.signal.aborted) interrupted = true;

    return { text, interrupted, tools: fired, ms: Date.now() - started };
  }
}
