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
