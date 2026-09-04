# Session 7 — The room

**You will build:** four practitioners in one conversation with you, each
deciding for themselves whether to speak or stay quiet, interruptible
mid-sentence.

**Files created:** `panel.ts`, `panel-cli.ts` (in `mentor-agent/`).

---

## The real problem is not four agents. It is turn-taking.

Running four models against one transcript is easy. Deciding **who talks next**
is the entire difficulty, and it is worth ten minutes on the whiteboard before
any code.

Ask the class for designs and take them seriously:

- **Round-robin.** Everyone speaks in order. This is a script, not a
  conversation, and it reads like four people who cannot hear each other.
- **A moderator agent** picks the next speaker. Works, but it is one model's
  opinion of what matters, and it adds a full round trip before every turn.
- **Everyone speaks every round.** Four answers to every sentence. Exhausting,
  and nobody ever gets to reply to anybody.
- **They bid.** After each turn, every silent practitioner privately scores how
  badly they want the floor. Highest claim speaks. If nobody clears a bar, the
  room goes quiet and waits for you.

We build the last one, because of one property the others lack: **silence is an
available move.** If a practitioner can decline to speak, then speaking means
something. That is also true of people.

## 1. `panel.ts`

```ts
// panel.ts — several psychologists in one room, and you.
//
// The 1:1 mentor in mentor.ts is a request/response agent: you speak, it
// answers, it stops. A panel is not that. Here four practitioners share one
// transcript, and after every single turn each of them independently decides
// whether to speak next or stay quiet — including staying quiet because a
// colleague is mid-thread with you and cutting in would wreck it.
//
// THE TURN-TAKING IS THE WHOLE PROBLEM. Round-robin would be a script, not a
// conversation. So each round every silent member privately bids on the floor:
// "how badly do I need to say something right now, 0-100". The bids run in
// parallel against a small model, the strongest one speaks, and if nobody
// clears the bar the floor comes back to you. Silence is an available move,
// which is what makes the speaking mean anything.
//
// You are never blocked. Interjecting aborts whoever is talking mid-sentence,
// keeps the half-finished line in the transcript exactly as a real interruption
// would, and everyone re-bids against what you just said.
import OpenAI from "openai";
import { recallBlock, runTool, toolsFor } from "./tools.js";
import { MODALITIES, modalityPrompt, type ModalityId } from "./modalities.js";
import { MODEL, OPERATING_NOTE, toolLabel, type Msg, type ToolEvent } from "./mentor.js";

// Constructed on first use, not at import. A module that throws merely because
// it was imported cannot be loaded by a test, a type checker, or a tool that
// only wants one exported constant out of it.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

/** Bidding happens on every silent member every round, so it runs cheap. */
export const BID_MODEL = process.env.BID_MODEL ?? "gpt-4o-mini";

/** Below this, nobody speaks and the floor returns to the person. */
const FLOOR_THRESHOLD = 50;

/** Consecutive clinician turns before the room hands back regardless of bids. */
const MAX_CONSECUTIVE = 4;

/** The last speaker has to want it much more than everyone else to go twice. */
const JUST_SPOKE_PENALTY = 40;

/** Being named by the previous speaker is a real claim on the floor. */
const ADDRESSED_BONUS = 20;

/**
 * A question a colleague just put to the person BELONGS to the person. Left to
 * itself the room stacks four questions in a row and never lets them answer —
 * every bidder thinks its own question is the good one. The rubric asks them to
 * hold back here and they don't, so it is enforced in code: only a claim strong
 * enough to survive this penalty gets to talk over an open question.
 */
const OPEN_QUESTION_PENALTY = 35;

export type Speaker = "user" | ModalityId;

/** Does this turn end on a question still owed an answer by the person? */
export function endsOnOpenQuestion(turn: PanelTurn | undefined): boolean {
  if (!turn || turn.speaker === "user" || turn.interrupted) return false;
  return /\?["')\]]?\s*$/.test(turn.text);
}

/** Did the previous speaker address this member by name? */
export function addressesMember(text: string, id: ModalityId): boolean {
  return new RegExp(`\\b${MODALITIES[id].panelName}\\b`, "i").test(text);
}

/**
 * The room's rules, applied to a raw urge. Pure, exported and tested, because
 * these three adjustments are precisely the ones the model would not honour
 * when they were only written in the bidding prompt — see the rubric in bid().
 * Keeping them here means a change to the room's manners shows up as a failing
 * test rather than as a conversation that feels subtly wrong.
 */
export function applyRoomRules(
  urge: number,
  id: ModalityId,
  last: PanelTurn | undefined,
): number {
  let score = urge;
  if (last?.speaker === id) score -= JUST_SPOKE_PENALTY;
  if (endsOnOpenQuestion(last)) score -= OPEN_QUESTION_PENALTY;
  if (last && last.speaker !== id && addressesMember(last.text, id)) score += ADDRESSED_BONUS;
  return Math.max(0, Math.min(100, score));
}

export interface PanelTurn {
  speaker: Speaker;
  text: string;
  /** True when the person cut in before this turn finished. */
  interrupted?: boolean;
  tools?: ToolEvent[];
  at: string;
}

export interface Bid {
  id: ModalityId;
  name: string;
  /** The model's raw wish to speak, 0-100. */
  urge: number;
  /** After the just-spoke penalty and the addressed-by-name bonus. */
  score: number;
  reason: string;
}

export interface PanelHandlers {
  /** Every round, before anyone speaks — this is the interesting telemetry. */
  onBids?: (bids: Bid[]) => void;
  onSpeakerStart?: (id: ModalityId, name: string) => void;
  onDelta?: (id: ModalityId, text: string) => void;
  onTool?: (id: ModalityId, event: ToolEvent) => void;
  onSpeakerEnd?: (turn: PanelTurn) => void;
  /** The room has gone quiet and is waiting for the person. */
  onFloor?: (reason: string) => void;
  /** A turn from the person entered the transcript. */
  onUser?: (turn: PanelTurn) => void;
}

function label(speaker: Speaker): string {
  if (speaker === "user") return "The person";
  const m = MODALITIES[speaker];
  return `${m.panelName} (${m.name})`;
}

/**
 * What a clinician is told about the room. Their own modality prompt still runs
 * underneath this unchanged — the panel adds a setting, not a new personality.
 */
function panelNote(id: ModalityId, members: ModalityId[]): string {
  const me = MODALITIES[id];
  const others = members
    .filter((x) => x !== id)
    .map((x) => `${MODALITIES[x].panelName} — ${MODALITIES[x].blurb}`)
    .join("\n  ");

  return `

YOU ARE IN A ROOM WITH COLLEAGUES, NOT A PRIVATE SESSION.

You are ${me.panelName}. Also present:
  ${others}
And the person themselves, who is in the room and can speak at any moment.

HOW YOU BEHAVE IN THE ROOM:
- SPEAK SHORT. Two or three sentences. Sometimes one. This is talking, not
  writing a formulation, and you will get another turn. Long paragraphs are how
  you take the room hostage.
- You hear everything everyone says. Never summarise or paraphrase what a
  colleague just said — everyone heard it, including the person.
- DISAGREE OUT LOUD when you think a colleague has it wrong, and say so to them
  by name. You are not here to build consensus. Four practitioners who agree
  about everything are one practitioner wasting three salaries.
- TALK TO YOUR COLLEAGUES, not only to the person. You can reply to Marek
  instead of to them. When the last thing said was a reading you don't share,
  saying so — "Sylvia, that's a story, and it's costing them the morning" — is
  worth more to this person than a fifth question aimed at their head.
- Never speak for the person, never answer on their behalf, never guess what
  they would say. If the next thing needed is their answer, stop and let them
  answer — you were not obliged to take this turn.
- IF A COLLEAGUE HAS JUST ASKED THEM SOMETHING AND YOU TAKE THE FLOOR ANYWAY,
  DO NOT ASK A SECOND QUESTION. Their question is still standing and it is not
  yours to bury. Say the thing your colleague missed, to your colleague, and
  leave the person the floor.
- LOOKING SOMETHING UP STOPS THE ROOM. Only search when the fact would settle
  something the four of you are actually stuck on, or when someone needs a real
  service. Never search to win a point against a colleague.
- Use your own vocabulary for what you see. Do not name a pattern in a
  colleague's language — if it needs their word, it is their observation.
- Do not introduce yourself, do not name your school, do not say "from where I
  sit as a behaviourist". Just work in your way and let it show.
- Do not open by addressing the person as though the room just started. You are
  in the middle of something.
- The written record is shared with the whole room. Only record what YOU have
  just identified, and never re-record something a colleague already logged.`;
}

/**
 * One turn as the rest of the room heard it. Tool calls are included on
 * purpose: the written record is shared, so if Iris has already logged the
 * labelling, everyone can see that and nobody logs it twice.
 */
function turnText(t: PanelTurn): string {
  const cut = t.interrupted ? " …[cut off]" : "";
  const logged = (t.tools ?? []).map((e) => `\n  [written into the record: ${e.label}]`).join("");
  return `${t.text}${cut}${logged}`;
}

/** A snapshot of the room, plain text, for the bidding model. */
function transcriptText(turns: PanelTurn[], limit = 14): string {
  return turns.slice(-limit).map((t) => `${label(t.speaker)}: ${turnText(t)}`).join("\n\n");
}

export class Panel {
  readonly transcript: PanelTurn[] = [];
  readonly members: ModalityId[];

  private inflight: AbortController | null = null;
  private running = false;
  /** Set by interject() while a clinician is mid-sentence. */
  private pending: string[] = [];
  private consecutive = 0;
  /** The most recent round of bids, kept so a page refresh doesn't lose the
   *  floor display — it is part of the room's visible state, not a UI event. */
  lastBids: Bid[] = [];

  constructor(members: ModalityId[] = ["cbt", "istdp", "analytical", "behavioral"]) {
    this.members = members.length ? members : ["cbt"];
  }

  get busy(): boolean {
    return this.running;
  }

  get lastSpeaker(): Speaker | null {
    return this.transcript[this.transcript.length - 1]?.speaker ?? null;
  }

  /**
   * The person says something. Legal at ANY time, including three words into a
   * clinician's sentence — that is the point. The half-finished turn stays in
   * the transcript, marked, because in a real room you don't get to pretend the
   * interrupted half was never said.
   */
  interject(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.pending.push(clean);
    this.inflight?.abort();
  }

  /** Stop the room without adding anything. */
  interrupt(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort();
    return true;
  }

  /**
   * Ask the room who wants the floor, without anyone speaking. Exposed for
   * evaluating turn-taking: a bid round is four cheap calls, where watching the
   * same decision through run() costs four full turns from the big model.
   */
  async pollBids(): Promise<Bid[]> {
    return this.collectBids();
  }

  /** Seed a transcript, for tests and for restoring a saved conversation. */
  load(turns: PanelTurn[]): void {
    this.transcript.push(...turns);
  }

  /**
   * Run the room until it hands the floor back. Safe to call again while it is
   * already running — the extra call returns immediately and the live loop
   * picks up whatever interject() queued.
   */
  async run(handlers: PanelHandlers = {}): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      for (;;) {
        // Anything the person queued goes in first and resets the room's
        // patience: their turn is never the one that gets crowded out.
        if (this.flushPending(handlers)) this.consecutive = 0;

        if (this.consecutive >= MAX_CONSECUTIVE) {
          handlers.onFloor?.("the room has been talking among itself — your turn");
          return;
        }

        const bids = await this.collectBids();
        if (this.pending.length) continue;      // they spoke while we were deciding
        this.lastBids = bids;
        handlers.onBids?.(bids);

        const winner = bids[0];
        if (!winner || winner.score < FLOOR_THRESHOLD) {
          handlers.onFloor?.(winner ? winner.reason : "nobody has anything to add");
          return;
        }

        const turn = await this.speak(winner.id, handlers);
        this.consecutive++;

        // Someone has just handed over a real service and a real number. The
        // room's job is finished for the moment, and in testing what followed
        // was three colleagues agreeing with each other that therapy is
        // important — the room talking to itself over the top of the one
        // useful thing anyone said. So it yields, in code, whatever the bids
        // would have wanted.
        if (turn.tools?.some((t) => t.name === "find_support")) {
          handlers.onFloor?.("that is what you need — the room will stop here");
          return;
        }

        // Interrupted mid-sentence: loop straight back so their words land
        // before anyone bids on the next turn.
        if (turn.interrupted && !this.pending.length) {
          handlers.onFloor?.("stopped");
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Move queued interjections into the shared transcript. */
  private flushPending(handlers: PanelHandlers): boolean {
    if (!this.pending.length) return false;
    this.lastBids = [];
    for (const text of this.pending.splice(0)) {
      const turn: PanelTurn = { speaker: "user", text, at: new Date().toISOString() };
      this.transcript.push(turn);
      handlers.onUser?.(turn);
    }
    return true;
  }

  /**
   * Every silent member decides, at the same time, whether to take the floor.
   * Nobody sees anyone else's bid — they are reacting to the room, not
   * negotiating. Returns them sorted, strongest claim first.
   */
  private async collectBids(): Promise<Bid[]> {
    const controller = new AbortController();
    this.inflight = controller;

    const last = this.transcript[this.transcript.length - 1];
    const room = transcriptText(this.transcript);

    try {
      const bids = await Promise.all(
        this.members.map((id) => this.bid(id, room, last, controller.signal)),
      );
      return bids.sort((a, b) => b.score - a.score);
    } finally {
      this.inflight = null;
    }
  }

  private async bid(
    id: ModalityId,
    room: string,
    last: PanelTurn | undefined,
    signal: AbortSignal,
  ): Promise<Bid> {
    const m = MODALITIES[id];

    const system = `You are ${m.panelName}, a clinician whose way of working is: ${m.blurb}.
You are in a room with three colleagues who work differently, and the person you are all here for.
Decide one thing only: should YOU speak next, right now?

Answer with JSON: {"urge": <0-100>, "reason": "<six words or fewer>"}

75-95  a colleague named you; or a colleague just gave a reading of this person
       that you would not give, and the difference matters; or the person's last
       message contains something only your way of working would catch.
50-74  you have something in the room that has not been said yet. A colleague
       handling it well is NOT a reason to stay quiet — they see one thing, you
       see another, and the person is here precisely because those differ.
20-49  you would only be agreeing, restating, or adding a footnote; or you just
       spoke and nothing has changed since.
0-19   a colleague has just asked the person a direct question and the person
       has not answered it yet. Speaking now takes their answer away from them.

That last one is the only thing that genuinely ruins a room. Everything else is
just conversation, and disagreement between you is the point of a panel rather
than a lapse in it. Give a specific number — never the round edge of a band.`;

    // Being named is computed here, not left for the bidder to notice. It was
    // missing it: addressed directly by a colleague, Marek would still return an
    // urge of 20, and a +20 bonus cannot rescue a bid the model scored that low.
    // The pattern is the same one used throughout the room — code establishes
    // the facts, the model exercises the judgement.
    const addressed = last && last.speaker !== id && addressesMember(last.text, id)
      ? `\n\nNOTE: ${m.panelName}, ${label(last.speaker)} addressed you BY NAME in that last ` +
        `turn. A colleague speaking to you directly is owed an answer from you, not from ` +
        `someone else.`
      : "";

    const user = `THE CONVERSATION SO FAR:\n\n${room || "(nothing said yet)"}${addressed}\n\nDo you speak next?`;

    let urge = 0;
    let reason = "";

    try {
      const res = await client().chat.completions.create(
        {
          model: BID_MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_object" },
          temperature: 0.6,
          max_tokens: 60,
        },
        { signal },
      );
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
      urge = Math.max(0, Math.min(100, Number(parsed.urge) || 0));
      reason = String(parsed.reason ?? "").slice(0, 80);
    } catch {
      // A bid that fails is a bid of zero. One flaky call must not take the
      // room down — the others still have a claim on the floor.
      return { id, name: m.panelName, urge: 0, score: 0, reason: "—" };
    }

    // The model judges the moment; the room's rules are applied in code so they
    // are predictable, inspectable and testable.
    return { id, name: m.panelName, urge, score: applyRoomRules(urge, id, last), reason };
  }

  /** The nudge handed to whoever wins the floor, tailored to what just happened. */
  private floorNote(): string {
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.speaker !== "user") {
      return `[You have the floor. Two or three sentences. ${label(last.speaker)} just ` +
        `spoke — if what you are about to say is a response to them, say it to them ` +
        `by name rather than aiming another question at the person.]`;
    }
    return "[You have the floor. Say your piece — two or three sentences.]";
  }

  /**
   * One clinician takes the floor. Their context is rebuilt from the shared
   * transcript every time, so nobody can drift out of sync with the room:
   * their own turns are assistant messages, everyone else's are user messages
   * carrying a name. Tool round-trips stay local to this call — the room hears
   * the reply, not the plumbing.
   */
  private async speak(id: ModalityId, handlers: PanelHandlers): Promise<PanelTurn> {
    const m = MODALITIES[id];
    const messages: Msg[] = [
      {
        role: "system",
        content: modalityPrompt(id) + panelNote(id, this.members) + OPERATING_NOTE + recallBlock(),
      },
      ...this.transcript.map((t): Msg =>
        t.speaker === id
          ? { role: "assistant", content: turnText(t) }
          : { role: "user", content: `${label(t.speaker)}: ${turnText(t)}` },
      ),
      { role: "user", content: this.floorNote() },
    ];

    const controller = new AbortController();
    this.inflight = controller;

    handlers.onSpeakerStart?.(id, m.panelName);

    const fired: ToolEvent[] = [];
    let text = "";
    let interrupted = false;

    try {
      for (let step = 0; step < 4; step++) {
        const stream = await client().chat.completions.create(
          { model: MODEL, messages, tools: toolsFor(id, m.vocabulary), temperature: 0.8, stream: true },
          { signal: controller.signal },
        );

        let content = "";
        const calls: { id: string; name: string; args: string }[] = [];

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
            text += delta.content;
            handlers.onDelta?.(id, delta.content);
          }
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
          ...(toolCalls.length
            ? { tool_calls: toolCalls.map((tc) => ({
                id: tc.id, type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
              })) }
            : {}),
        } as Msg);

        if (!toolCalls.length) break;

        for (const tc of toolCalls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.args || "{}");
          } catch {
            messages.push({ role: "tool", tool_call_id: tc.id,
              content: JSON.stringify({ ok: false, error: "arguments were not valid JSON" }) });
            continue;
          }
          const result = await runTool(tc.name, args, id, controller.signal);
          const event: ToolEvent = {
            name: tc.name, args, label: toolLabel(tc.name, args),
            ...(result.sources?.length ? { sources: result.sources } : {}),
          };
          fired.push(event);
          handlers.onTool?.(id, event);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result.content });
        }
      }
    } catch (err) {
      const aborted =
        err instanceof OpenAI.APIUserAbortError ||
        (err as { name?: string })?.name === "AbortError";
      if (!aborted) {
        this.inflight = null;
        const turn: PanelTurn = {
          speaker: id, text: text || `(${m.panelName} lost their thread)`,
          tools: fired, at: new Date().toISOString(),
        };
        this.transcript.push(turn);
        handlers.onSpeakerEnd?.(turn);
        throw err;
      }
      interrupted = true;
    } finally {
      this.inflight = null;
    }

    // An interrupted turn is kept, cut off where it was cut off. Everyone —
    // including the clinician who was speaking — sees the fragment next round.
    const turn: PanelTurn = {
      speaker: id,
      text: text.trim(),
      interrupted,
      tools: fired.length ? fired : undefined,
      at: new Date().toISOString(),
    };
    if (turn.text) this.transcript.push(turn);
    handlers.onSpeakerEnd?.(turn);
    return turn;
  }
}
```

## 2. `panel-cli.ts`

```ts
// panel-cli.ts — the terminal interface to the panel. All the logic is in
// panel.ts; this file only knows about readline and ANSI codes.
//
// Run:  npm run panel
//
// The input line stays live the entire time. You do not wait for a prompt —
// type whenever you want and press enter, and whoever is talking gets cut off
// mid-sentence. That is the feature, not a glitch.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Panel, type Bid, type PanelHandlers } from "./panel.js";
import { MODEL } from "./mentor.js";
import { BID_MODEL } from "./panel.js";
import { readState } from "./tools.js";
import { SEARCH_MODEL } from "./search.js";
import { MODALITIES, isModalityId, type ModalityId } from "./modalities.js";

const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[38;5;114m${s}\x1b[0m`,
};

// One colour each, so you can follow who is talking without reading the name.
const VOICE: Record<ModalityId, (s: string) => string> = {
  cbt: c.blue,
  istdp: c.red,
  analytical: c.violet,
  behavioral: c.green,
};

function printState(): void {
  const s = readState();
  console.log(`\n${c.bold("  goals")}`);
  if (!s.goals.length) console.log(c.dim("    (none yet)"));
  for (const g of s.goals) {
    const who = g.modality ? c.dim(` — ${MODALITIES[g.modality].panelName}`) : "";
    const status = g.status && g.status !== "open"
      ? ` ${g.status === "kept" ? c.green(`[${g.status}]`) : c.amber(`[${g.status}]`)}`
      : "";
    console.log(`    • ${g.goal}${g.deadline ? c.dim(` [${g.deadline}]`) : ""}${status}${who}`);
    if (g.outcome) console.log(c.dim(`      ${g.outcome}`));
  }
  console.log(`\n${c.bold("  patterns flagged")}`);
  if (!s.beliefs.length) console.log(c.dim("    (none yet)"));
  for (const b of s.beliefs) {
    const who = b.modality ? MODALITIES[b.modality].panelName : "?";
    console.log(`    • ${b.belief} ${c.dim(`[${b.distortion} — ${who}]`)}`);
  }
  console.log();
}

function bidLine(bids: Bid[]): string {
  return bids
    .map((b) => {
      const txt = `${b.name} ${String(b.score).padStart(3)}`;
      return b.score >= 50 ? VOICE[b.id](txt) : c.dim(txt);
    })
    .join(c.dim("  ·  "));
}

async function main(): Promise<void> {
  // PANEL=istdp,behavioral npm run panel  — or all four by default.
  const members = (process.env.PANEL ?? "cbt,istdp,analytical,behavioral")
    .split(",").map((s) => s.trim().toLowerCase()).filter(isModalityId) as ModalityId[];

  const panel = new Panel(members.length ? members : undefined);
  const state = readState();

  console.log();
  console.log(`  ${c.bold(c.violet("the room"))} ${c.dim("·")} ${c.bold("four practitioners and you")}`);
  for (const id of panel.members) {
    const m = MODALITIES[id];
    console.log(`    ${VOICE[id]("●")} ${c.bold(m.panelName.padEnd(9))}${m.name.padEnd(12)}${c.dim(m.blurb)}`);
  }
  console.log();
  console.log(c.dim(`  speaking: ${MODEL} · bidding for the floor: ${BID_MODEL} · searching: ${SEARCH_MODEL}`));
  console.log(c.dim(`  memory: ${state.goals.length} goal(s), ${state.beliefs.length} pattern(s)`));
  console.log(c.dim(`  type any time — enter cuts off whoever is talking. /state, /bids, /exit`));
  console.log();

  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: c.blue("\n› ") });

  let showBids = true;
  let speaking = false;   // true between onSpeakerStart and onSpeakerEnd

  const handlers: PanelHandlers = {
    onBids: (bids) => {
      if (showBids) console.log(`\n${c.dim("  who wants the floor:")}  ${bidLine(bids)}`);
    },
    onSpeakerStart: (id, name) => {
      speaking = true;
      const m = MODALITIES[id];
      stdout.write(`\n${VOICE[id](c.bold(name))} ${c.dim(m.name)}\n  `);
    },
    onDelta: (_id, text) => stdout.write(text.replace(/\n/g, "\n  ")),
    onTool: (id, event) => {
      const mark = event.name === "web_search" || event.name === "find_support" ? "⌕" : "✎";
      stdout.write(`\n  ${c.amber(`${mark} ${MODALITIES[id].panelName}: ${event.label}`)}\n`);
      for (const src of event.sources ?? []) {
        stdout.write(c.dim(`     ${src.title.slice(0, 62)}\n     ${src.url}\n`));
      }
      stdout.write("  ");
    },
    onSpeakerEnd: (turn) => {
      speaking = false;
      stdout.write(turn.interrupted ? c.amber("  ⨯ cut off\n") : "\n");
    },
    onUser: (turn) => {
      // Only worth marking when it landed mid-sentence; otherwise they can see
      // what they typed one line above.
      if (speaking) console.log(c.dim(`\n  ⤷ you: ${turn.text}`));
    },
    onFloor: (reason) => {
      console.log(c.dim(`\n  — the room is waiting for you  (${reason})`));
    },
  };

  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return;

    if (text === "/exit" || text === "/quit") { rl.close(); return; }
    if (text === "/state") { printState(); rl.prompt(); return; }
    if (text === "/bids") {
      showBids = !showBids;
      console.log(c.dim(`  floor bids ${showBids ? "shown" : "hidden"}`));
      rl.prompt();
      return;
    }

    panel.interject(text);
    if (panel.busy) return;          // the live loop will pick it up

    try {
      await panel.run(handlers);
    } catch (err) {
      console.log(c.red(`\n  error: ${(err as Error).message}`));
    }
    rl.prompt();
  });

  // Ctrl+C stops the room mid-sentence; a second one leaves.
  rl.on("SIGINT", () => {
    if (panel.interrupt()) return;
    rl.close();
  });

  await new Promise<void>((resolve) => rl.on("close", resolve));
  console.log(c.dim("\n  The room remembers. Your commitments are on disk.\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
```

Add the script to `mentor-agent/package.json`:

```json
"panel": "tsx --env-file=.env panel-cli.ts"
```

Run `npm run panel` and tell the room something you actually avoid.

---

## What each part is doing

### One transcript, rebuilt per speaker

```ts
...this.transcript.map((t): Msg =>
  t.speaker === id
    ? { role: "assistant", content: turnText(t) }
    : { role: "user", content: `${label(t.speaker)}: ${turnText(t)}` },
),
```

There is one shared `transcript`, and each practitioner's message array is built
from it **fresh on every turn**: their own turns become `assistant`, everyone
else's — colleagues and the person alike — become `user` messages prefixed with
a name.

That is the standard trick for multi-agent conversation, and it has a
consequence worth stating: nobody can drift out of sync, because nobody holds
their own history. There is one history, and four views of it.

Tool round trips stay local to the speaking call and never enter the
transcript. The room hears the reply, not the plumbing.

### The bid

```ts
const bids = await Promise.all(
  this.members.map((id) => this.bid(id, room, last, controller.signal)),
);
return bids.sort((a, b) => b.score - a.score);
```

Four calls, in parallel, one per practitioner. Nobody sees anyone else's bid —
they are reacting to the room, not negotiating with each other. `Promise.all`
means the round costs one round trip, not four.

They run on a cheap model (`BID_MODEL`, `gpt-4o-mini`) with
`max_tokens: 60` and `response_format: { type: "json_object" }`, because this
happens on every turn for every member and the answer is two fields.

The rubric is the interesting prompt in this file:

```
75-95  a colleague named you; or a colleague just gave a reading of this person
       that you would not give, and the difference matters; or the person's last
       message contains something only your way of working would catch.
50-74  you have something in the room that has not been said yet. A colleague
       handling it well is NOT a reason to stay quiet...
20-49  you would only be agreeing, restating, or adding a footnote...
0-19   a colleague has just asked the person a direct question and the person
       has not answered it yet.
```

> **What went wrong, twice.** The first rubric ended with *"Silence is a real
> move and the commonest right answer."* Every practitioner then bid **exactly
> 40** — the bottom edge of the middle band — with reasons like *"a colleague is
> engaging the person well."* Nobody ever cleared the bar, and the room
> degenerated into a 1:1 with a rotating chair.
>
> Rewriting the bands to treat *disagreement as the point of a panel* fixed
> that and immediately caused the opposite failure: four practitioners each
> asking the person a fresh question, in a row, never letting them answer, never
> talking to each other. Every bidder rated its own question the good one.

### Three rules live in code, not in the prompt

This is the most transferable idea in the session.

```ts
let score = urge;
if (last?.speaker === id) score -= JUST_SPOKE_PENALTY;                    // 40
if (last && last.speaker !== "user" && !last.interrupted
    && /\?["')\]]?\s*$/.test(last.text)) score -= OPEN_QUESTION_PENALTY;  // 35
if (last && last.speaker !== id && this.namesMe(last.text, id))
  score += ADDRESSED_BONUS;                                               // 20
```

| rule | without it |
|---|---|
| the last speaker is penalised 40 | one voice monologues |
| an open question to the person costs 35 | four questions stack up and nobody gets to answer |
| being named earns 20 | "Marek, I disagree" does not reach Marek |

The rubric already asked for all three in plain English. **The model ignored the
middle one every single time.** Adding it in code fixed it in one attempt — and
the effect is visible in the bid log immediately:

```
BIDS  Marek:50(85)   Sylvia:30(65)   Theo:20 "Let them answer Iris's question first."   Iris:0(75)
```

The two numbers are the raw urge and the adjusted score. Everyone still *wants*
to speak; the room's rules decide who gets to.

The principle: **use the model for judgement, use code for rules.** "Is this
worth interrupting for?" is judgement. "Do not talk over an unanswered question"
is a rule, and rules belong somewhere they cannot be talked out of. When the
model keeps ignoring a prompt instruction, that is often a sign the instruction
was never a judgement call to begin with.

Note also that these adjustments are **inspectable**. When the room does
something surprising you can print the bids and see exactly which term caused
it. A moderator agent gives you no such handle.

### The floor comes back to you

```ts
const winner = bids[0];
if (!winner || winner.score < FLOOR_THRESHOLD) {
  handlers.onFloor?.(winner ? winner.reason : "nobody has anything to add");
  return;
}
```

Below 50, nobody speaks. `MAX_CONSECUTIVE` (4) is the backstop for a room that
gets excited and keeps clearing the bar.

And one more hard yield:

```ts
if (turn.tools?.some((t) => t.name === "find_support")) {
  handlers.onFloor?.("that is what you need — the room will stop here");
  return;
}
```

> **What went wrong.** Asked for a therapist in Berlin, Theo produced a real
> crisis line — and then three colleagues spent three turns agreeing with each
> other that therapy is important, on top of the one useful thing anyone had
> said. Once someone has handed over a real number, the room getting out of the
> way *is* the correct next move, so it yields in code whatever the bids want.

### Interrupting

```ts
interject(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  this.pending.push(clean);
  this.inflight?.abort();
}
```

Two lines of actual work: queue what you said, kill whoever is talking. `run()`
flushes the queue at the top of its loop, so your words are in the transcript
before anyone bids on the next turn.

The interrupted half-turn is **kept**, marked `interrupted`, and everyone sees
it next round as `…[cut off]` — the same reasoning as session 3, now visible to
four other participants.

`this.inflight` is reused for both the bidding round and the speaking turn, so
cutting in during either works.

### The room is not blocking

`run()` is a loop that keeps going until the floor comes back. In the terminal
that means the prompt cannot own the input:

```ts
rl.on("line", async (line) => {
  ...
  panel.interject(text);
  if (panel.busy) return;          // the live loop will pick it up
  await panel.run(handlers);
  rl.prompt();
});
```

An event listener, not `await rl.question(...)`. The input line stays live the
entire time — you do not wait for a prompt, you type whenever you want.

### What the practitioners are told about being in a room

Their modality prompt from session 4 runs underneath, unchanged. `panelNote()`
adds the setting, and every line of it is there because of something that
happened:

```
- SPEAK SHORT. Two or three sentences... Long paragraphs are how you take the
  room hostage.
- Never summarise or paraphrase what a colleague just said — everyone heard it.
- DISAGREE OUT LOUD... Four practitioners who agree about everything are one
  practitioner wasting three salaries.
- TALK TO YOUR COLLEAGUES, not only to the person.
- IF A COLLEAGUE HAS JUST ASKED THEM SOMETHING AND YOU TAKE THE FLOOR ANYWAY,
  DO NOT ASK A SECOND QUESTION.
- LOOKING SOMETHING UP STOPS THE ROOM.
```

### The shared record, actually shared

```ts
function turnText(t: PanelTurn): string {
  const cut = t.interrupted ? " …[cut off]" : "";
  const logged = (t.tools ?? []).map((e) => `\n  [written into the record: ${e.label}]`).join("");
  return `${t.text}${cut}${logged}`;
}
```

Tool calls go into the transcript everyone reads, so if Iris has already logged
the labelling, nobody logs it twice.

And the per-lens vocabulary from session 4 finally gets used:

```ts
{ model: MODEL, messages, tools: toolsFor(id, m.vocabulary), temperature: 0.8, stream: true },
```

> **What went wrong.** With the shared tool description, which lists all four
> traditions' terminology, the **CBT** chair logged *"negative reinforcement of
> avoidance"* — the behaviourist's word. The record stopped being attributable.
> `toolsFor()` rewrites the `distortion` description per speaker so each one
> only sees their own vocabulary. After the change: Iris logged *emotional
> reasoning*, Sylvia logged *complex*. Same conversation.

Belt and braces in `runTool` as well — four people hearing one promise is not
four promises:

```ts
const dup = state.goals.find((g) => same(g.goal, args.goal));
if (dup) {
  return wrap({ ok: true, alreadyRecorded: true, ...
    note: "This commitment is already in the shared record. Do not log it again..." });
}
```

---

## What it looks like when it works

One conversation, unedited, about working past nine every night:

> **Theo** — When you end up working past the time you committed to, what
> happens right before?
> **Marek** — *Theo, that's a helpful angle, but* they use the phrase "just this
> one project." That's a defense…
> **Theo** — *Marek, I hear you, but* focusing on the feeling might not change
> the behavior. "Just this one project" also indicates a competing reinforcer.
> **Marek** — *Theo, identifying the reinforcer is important, but* if the denial
> remains unaddressed the cycle persists.

Two practitioners, arguing, by name, about a real person in the room. Nothing in
the code says "argue" — it falls out of four different theories reading one
transcript and being allowed to want the floor.

And when the person cut in with *"do not tell me to just say no, I have heard
that"*, Theo — the behaviourist, the one most likely to say exactly that — bid
45 and stayed out.

---

## Exercises

1. Print every bid every round (`/bids` toggles it). Watch a practitioner decide
   to stay quiet, and read the reason. This is the best debugging tool in the
   project.
2. Change `FLOOR_THRESHOLD` to 20 and to 80. Neither is a conversation. Discuss
   why.
3. Delete `OPEN_QUESTION_PENALTY` and count how many questions stack up.
4. Run `PANEL=istdp,behavioral npm run panel`. Two practitioners is a different
   dynamic from four — is it better?
5. Give one member a much larger `ADDRESSED_BONUS`. What kind of person have you
   just built?

---

**Next:** [Session 8 — The room in the browser](08-the-room-in-the-browser.md).
