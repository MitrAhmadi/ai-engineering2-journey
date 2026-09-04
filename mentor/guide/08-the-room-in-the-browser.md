# Session 8 — The room in the browser

**You will build:** the finished app — the room, with a portrait for each
practitioner and a live view of who wants to speak.

**Files created:** `Room.tsx`, `Avatar.tsx`. **Files changed:**
`server/server.ts`, `App.tsx`, `app.css`.

---

## The one new idea

Session 6 streamed over the POST that started the turn. That works because the
1:1 mentor only speaks when asked.

**The room does not.** It keeps talking after your request has returned — four
practitioners take turns while you sit there. There is no request to stream on.

So the room needs a **persistent** stream that every open tab subscribes to,
and events get broadcast onto it whenever they happen, no matter what started
them. Which is what SSE is actually for, and this time we can use the browser's
built-in `EventSource`, because it is a GET.

## 1. The server gains a broadcast channel

```ts
const { Panel, BID_MODEL } = await import(pathToFileURL(path.join(AGENT, "panel.ts")).href);

type AnyPanel = InstanceType<typeof Panel>;
let panel: AnyPanel = new Panel();

const listeners = new Set<http.ServerResponse>();

function broadcast(event: unknown): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(frame);
}

const panelHandlers = {
  onUser:         (turn: unknown) => broadcast({ type: "user", turn }),
  onBids:         (bids: unknown) => broadcast({ type: "bids", bids }),
  onSpeakerStart: (id: string, name: string) => broadcast({ type: "speaker", id, name }),
  onDelta:        (id: string, text: string) => broadcast({ type: "delta", id, text }),
  onTool:         (id: string, event: unknown) => broadcast({ type: "tool", id, event }),
  onSpeakerEnd:   (turn: unknown) => broadcast({ type: "end", turn, memory: readState() }),
  onFloor:        (reason: string) => broadcast({ type: "floor", reason }),
};
```

The same handler interface as session 3 and session 6. Third sink, no change to
the core.

### The stream route

```ts
if (route === "/api/panel/stream") {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "hello", state: panelState() })}\n\n`);
  listeners.add(res);
  // A proxy that buffers will hold the whole conversation until it ends,
  // which for this UI is the same as it never arriving.
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => { clearInterval(ping); listeners.delete(res); });
  return;
}
```

Three things to point out:

**The `hello` event carries the whole state.** A tab that connects late — or
refreshes — gets the current transcript immediately, then live events. Without
this, a refresh shows an empty room that is mid-conversation.

**`req.on("close")` removes the listener.** Forget it and every closed tab stays
in the `Set`, and you write to dead sockets forever. This is the standard SSE
leak.

**The `: ping` comment.** A line starting with `:` is a comment in the SSE
format — it is ignored by the client and exists purely to push bytes through
anything that buffers. Twenty seconds is comfortably inside the usual idle
timeouts.

### Saying something is fire-and-forget

```ts
if (route === "/api/panel/say" && req.method === "POST") {
  const { text } = await readBody(req);
  panel.interject(String(text ?? ""));
  pump();
  return json(res, { ok: true });
}
```

```ts
/** Start the room if it is idle. Never awaited — the response goes back now. */
function pump(): void {
  if (panel.busy) return;
  panel.run(panelHandlers)
    .catch((err: Error) => broadcast({ type: "error", message: err.message }))
    .finally(() => broadcast({ type: "idle" }));
}
```

`pump()` is deliberately not awaited. The POST returns immediately with
`{ok: true}`; the conversation it started arrives on the stream, over the next
minute, to every tab. If the room is already running, `interject` has already
cut off the speaker and the live loop will pick the message up.

This is the structural difference from session 6 in three lines, and it is worth
making explicit: **the request no longer owns the work it caused.**

Note the `.catch` — an unawaited promise that rejects is an unhandled rejection
that can take the process down. Fire-and-forget always needs a catch.

### Keeping the bids across a refresh

```ts
this.lastBids = bids;   // in panel.ts
```

```ts
transcript: panel.transcript,
bids: panel.lastBids,
```

Who wants the floor is **state**, not a passing event, so it belongs in
`panelState()` and survives a reload.

## 2. `Avatar.tsx`

```tsx
// Avatar.tsx — a portrait for each practitioner, drawn as the thing they
// actually look for. Not decoration: the glyph is the theory.
//
//   Iris  (CBT)         a lattice of thoughts, one node ringed and tested
//   Marek (ISTDP)       the triangle of conflict, pressure rising from below
//   Sylvia (Analytical) the circle half in shadow, with the split-off piece outside it
//   Theo  (Behavioral)  three steps and the loop that keeps paying for them
//
// Inline SVG, no assets, no network. They inherit currentColor, so a voice's
// colour only has to be set once in CSS.

import type { ReactElement } from "react";

const GLYPH: Record<string, ReactElement> = {
  user: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="20" cy="20" r="10.5" opacity=".45" />
      <circle cx="20" cy="20" r="4" fill="currentColor" stroke="none" opacity=".8" />
    </g>
  ),
  cbt: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M12 28 L12 15 L24 15" opacity=".5" />
      <path d="M12 21 L27 21" opacity=".5" />
      <path d="M19 28 L19 12" opacity=".5" />
      <circle cx="12" cy="28" r="1.6" fill="currentColor" stroke="none" opacity=".6" />
      <circle cx="27" cy="21" r="1.6" fill="currentColor" stroke="none" opacity=".6" />
      <circle cx="19" cy="15" r="4.2" />
      <path d="M15.6 11.6 L22.4 18.4" />
    </g>
  ),
  istdp: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 9 L30.5 28 L9.5 28 Z" opacity=".55" />
      <circle cx="20" cy="9" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="30.5" cy="28" r="1.9" fill="currentColor" stroke="none" opacity=".55" />
      <circle cx="9.5" cy="28" r="1.9" fill="currentColor" stroke="none" opacity=".55" />
      <path d="M20 25.5 L20 15.5" />
      <path d="M17.2 18 L20 15 L22.8 18" />
    </g>
  ),
  analytical: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="18.5" cy="20" r="10.5" opacity=".55" />
      <path d="M18.5 9.5 A10.5 10.5 0 0 1 18.5 30.5 Z" fill="currentColor" stroke="none" opacity=".32" />
      <circle cx="18.5" cy="20" r="2.6" />
      <circle cx="31" cy="10.5" r="2.4" fill="currentColor" stroke="none" opacity=".85" />
    </g>
  ),
  behavioral: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 28 L15 28 L15 22 L21 22 L21 16 L27 16" opacity=".85" />
      <circle cx="27" cy="16" r="1.9" fill="currentColor" stroke="none" />
      <path d="M30 18.5 C33 25 27 31 20 30.6" opacity=".5" />
      <path d="M22.6 28.6 L19.6 30.8 L21.4 33.4" opacity=".5" />
    </g>
  ),
};

export default function Avatar({ id, size = 38 }: { id: string; size?: number }) {
  return (
    <span className={`avatar ${id}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        {GLYPH[id] ?? null}
      </svg>
    </span>
  );
}
```

Each glyph is the thing that practitioner actually looks for: Marek is the
triangle of conflict with pressure rising from the base, Sylvia is the circle
half in shadow with the split-off piece outside it, Theo is three steps and the
loop that keeps paying for them, Iris is a lattice with one node ringed and
tested.

Inline SVG, no image files, no network requests, and they inherit
`currentColor` — so a voice's colour is set once on the row in CSS and the
avatar, the name, the rule and the bid bar all follow.

> **What went wrong.** The search icon was the Unicode magnifier, U+2315. In
> most fonts at 12px it renders as an illegible dot. `ToolReceipt` draws its own
> instead. If an icon has to be legible at a specific size, draw it.

## 3. `Room.tsx`

```tsx
// Room.tsx — four practitioners talking to each other and to you.
//
// The 1:1 view is request/response: you send, it streams, it stops. This one
// is not. The room keeps talking after your POST has returned, so everything
// arrives on one long-lived EventSource and the composer is never disabled —
// pressing enter while someone is mid-sentence is the point.
import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import ToolReceipt, { type ToolEvent } from "./ToolReceipt";
import RichText from "./RichText";


interface Turn {
  speaker: string;                  // "user" | modality id
  text: string;
  interrupted?: boolean;
  tools?: ToolEvent[];
  at?: string;
  /** Set on the local placeholder while a turn is still streaming. */
  live?: boolean;
}

interface Member { id: string; name: string; panelName: string; blurb: string }
interface Bid { id: string; name: string; urge: number; score: number; reason: string }
interface Memory { goals: any[]; beliefs: any[] }

const FLOOR_THRESHOLD = 50;   // mirrors panel.ts, for colouring only

export default function Room() {
  const [members, setMembers] = useState<Member[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [memory, setMemory] = useState<Memory>({ goals: [], beliefs: [] });
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [floor, setFloor] = useState("");
  const [model, setModel] = useState("");
  const [bidModel, setBidModel] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const byId = (id: string) => members.find((m) => m.id === id);

  useEffect(() => {
    const es = new EventSource("/api/panel/stream");

    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);

      if (ev.type === "hello" || ev.type === "reset") {
        setMembers(ev.state.members);
        setTurns(ev.state.transcript);
        setMemory(ev.state.memory);
        setModel(ev.state.model);
        setBidModel(ev.state.bidModel);
        setBids(ev.state.bids ?? []);
        setSpeaking(null);
        setFloor("");
      } else if (ev.type === "user") {
        setTurns((t) => [...t, ev.turn]);
        setBids([]);
        setFloor("");
        setDeciding(true);
      } else if (ev.type === "bids") {
        setBids(ev.bids);
        setDeciding(false);
      } else if (ev.type === "speaker") {
        setSpeaking(ev.id);
        setTurns((t) => [...t, { speaker: ev.id, text: "", tools: [], live: true }]);
      } else if (ev.type === "delta") {
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, text: last.text + ev.text };
          return next;
        });
      } else if (ev.type === "tool") {
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, tools: [...(last.tools ?? []), ev.event] };
          return next;
        });
      } else if (ev.type === "end") {
        setSpeaking(null);
        setMemory(ev.memory);
        setDeciding(true);
        // Replace the streamed placeholder with the turn the server recorded —
        // an interrupted one has to keep its cut-off flag.
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          if (last?.live) {
            if (!ev.turn.text) { next.pop(); return next; }
            next[next.length - 1] = { ...ev.turn, live: false };
          }
          return next;
        });
      } else if (ev.type === "floor") {
        setFloor(ev.reason);
        setDeciding(false);
      } else if (ev.type === "idle") {
        setSpeaking(null);
        setDeciding(false);
      } else if (ev.type === "error") {
        setError(ev.message);
        setDeciding(false);
      }
    };

    es.onerror = () => setError("lost the stream — is the server still up?");
    return () => es.close();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, bids, floor]);

  function say() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setError("");
    fetch("/api/panel/say", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => setError("could not reach the server"));
  }

  const busy = !!speaking || deciding;

  return (
    <div className="app">
      <main className="chat">
        <header className="bar">
          <div className="brand-block">
            <span className="faces">
              {members.map((m) => (
                <span key={m.id} className={`face ${m.id} ${speaking === m.id ? "live" : ""}`}
                      title={`${m.panelName} — ${m.blurb}`}>
                  <Avatar id={m.id} size={30} />
                </span>
              ))}
            </span>
            <span>
              <span className="brand">the room</span>
              <span className="sub">four practitioners, one transcript, and you</span>
            </span>
          </div>
          <div className="bar-right">
            <span className="model">{model}{bidModel && ` · floor ${bidModel}`}</span>
            <button className="ghost" onClick={() => fetch("/api/panel/stop", { method: "POST" })}
                    disabled={!speaking}>
              stop
            </button>
            <button className="ghost" onClick={() => fetch("/api/panel/reset", { method: "POST" })}>
              clear the room
            </button>
          </div>
        </header>

        <div className="scroll" ref={scrollRef}>
          {turns.length === 0 && (
            <div className="empty">
              <p className="empty-title">Four practitioners who do not agree with each other.</p>
              <p>
                They share one transcript, and after every turn each of them decides
                privately whether to speak or stay quiet. Nobody takes turns in order —
                they bid for the floor, and when nobody has a strong enough claim the
                room goes quiet and waits for you.
              </p>
              <p className="empty-lens">
                You are never queued. Type while someone is mid-sentence and they get
                cut off, exactly where they were cut off.
              </p>
              <p className="empty-hint">Tell the room what you're avoiding.</p>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={`turn ${t.speaker === "user" ? "you" : `voice ${t.speaker}`}`
                        + (t.live && speaking === t.speaker ? " live" : "")}>
              <Avatar id={t.speaker} />
              <div className="turn-body">
                <div className="who">
                  {t.speaker === "user" ? "You" : byId(t.speaker)?.panelName ?? t.speaker}
                  {t.speaker !== "user" && <span className="school">{byId(t.speaker)?.name}</span>}
                </div>
                <div className="body">
                  <RichText text={t.text} />
                  {t.interrupted && <span className="cutoff"> — cut off</span>}
                  {t.live && !t.text && <span className="thinking">…</span>}
                </div>
                {!!t.tools?.length && (
                  <div className="tools">
                    {t.tools.map((tool, j) => <ToolReceipt key={j} event={tool} />)}
                  </div>
                )}
              </div>
            </div>
          ))}

        </div>

        {/* The floor, pinned. Who wants to speak right now is live state, and
            watching a clinician decide to stay out of it is more informative
            than watching one talk. */}
        {(!!bids.length || !!floor) && (
          <div className="floor-strip">
            {!!bids.length && (
            <div className="bids">
              <div className="bids-head">
                {speaking
                  ? `${byId(speaking)?.panelName ?? ""} took the floor`
                  : floor ? "nobody took the floor" : "who wants the floor"}
              </div>
              {bids.map((b) => (
                <div key={b.id} className={`bid ${b.id} ${b.score >= FLOOR_THRESHOLD ? "in" : "out"}`}>
                  <Avatar id={b.id} size={20} />
                  <span className="bid-name">{b.name}</span>
                  <span className="bid-bar"><i style={{ width: `${b.score}%` }} /></span>
                  <span className="bid-score">{b.score}</span>
                  <span className="bid-reason">{b.reason}</span>
                </div>
              ))}
            </div>
          )}

          {floor && <div className="floor-note">the room is waiting for you — {floor}</div>}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="composer">
          <textarea
            value={input}
            placeholder={speaking
              ? `${byId(speaking)?.panelName} is talking — press enter to cut in`
              : "What are you avoiding?"}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); say(); }
            }}
          />
          {/* Never disabled. Interrupting is a first-class move here. */}
          <button className={speaking ? "cut" : "send"} onClick={say} disabled={!input.trim()}>
            {speaking ? "cut in" : "send"}
          </button>
        </div>
      </main>

      <aside className="memory">
        <div className="memory-head">
          <h2>In the room</h2>
          <p>{busy ? "talking" : "waiting for you"}</p>
        </div>

        <section>
          {members.map((m) => (
            <div key={m.id} className={`member ${m.id} ${speaking === m.id ? "live" : ""}`}>
              <Avatar id={m.id} size={34} />
              <div>
                <div className="member-name">{m.panelName}<span className="school">{m.name}</span></div>
                <div className="member-blurb">{m.blurb}</div>
              </div>
            </div>
          ))}
        </section>

        <div className="memory-head">
          <h2>The shared record</h2>
          <p>One file on disk. Everyone writes to it, everyone reads it.</p>
        </div>

        <section>
          <h3>Goals <span className="count">{memory.goals.length}</span></h3>
          {memory.goals.length === 0 && <p className="none">Nothing committed to yet.</p>}
          {memory.goals.map((g, i) => (
            <div key={i} className={`card goal ${g.modality ?? ""} ${g.status ?? "open"}`}>
              <div className="card-main">{g.goal}</div>
              {g.status && g.status !== "open" && <span className={`status ${g.status}`}>{g.status}</span>}
              {g.deadline && <div className="deadline">{g.deadline}</div>}
              {g.outcome && <div className="card-why">{g.outcome}</div>}
              <div className="card-date">
                logged by {byId(g.modality)?.panelName ?? "—"}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3>Patterns <span className="count">{memory.beliefs.length}</span></h3>
          {memory.beliefs.length === 0 && <p className="none">None flagged yet.</p>}
          {memory.beliefs.map((b, i) => (
            <div key={i} className={`card belief ${b.modality ?? ""}`}>
              <div className="card-main">“{b.belief}”</div>
              <div className="distortion">{b.distortion}</div>
              <div className="card-date">
                logged by {byId(b.modality)?.panelName ?? "—"}
              </div>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
```

### What to point out

**`EventSource` is four lines and reconnects itself.**

```ts
const es = new EventSource("/api/panel/stream");
es.onmessage = (e) => { const ev = JSON.parse(e.data); ... };
es.onerror = () => setError("lost the stream — is the server still up?");
return () => es.close();
```

No buffering, no `\n\n` splitting, no `TextDecoder` — the browser does the
framing. Compare with the hand-rolled parser in `Solo.tsx` and ask the class why
we could not use this there. (Answer: `EventSource` is GET-only.)

The cleanup function returning `es.close()` is not optional. In React strict
mode the effect runs twice in development, and without it you hold two streams.

**The `live` placeholder is reconciled at the end.**

```ts
} else if (ev.type === "end") {
  setTurns((t) => {
    const next = [...t];
    const last = next[next.length - 1];
    if (last?.live) {
      if (!ev.turn.text) { next.pop(); return next; }
      next[next.length - 1] = { ...ev.turn, live: false };
    }
    return next;
  });
```

The client builds a placeholder on `speaker` and fills it with deltas, but the
**server's** version of that turn is authoritative — it knows whether it was
interrupted. If a turn produced no text at all (cut off before the first token,
or a turn that was only tool calls), the placeholder is removed rather than left
as an empty bubble.

**The composer is never disabled.**

```tsx
<button className={speaking ? "cut" : "send"} onClick={say} disabled={!input.trim()}>
  {speaking ? "cut in" : "send"}
</button>
```

Compare `Solo.tsx`, where `busy` disables everything. Here, interrupting is a
first-class move, so the only reason the button is ever disabled is an empty
box. The placeholder text changes to say so: *"Marek is talking — press enter to
cut in."*

**The bid strip is pinned above the composer, not in the scrollback.**

> **What went wrong.** It was originally rendered inline in the transcript,
> which is wrong in a way that took a screenshot to notice: who wants the floor
> *right now* is live state, not a historical event. Buried at the bottom of the
> scroll it was also invisible most of the time — and it is the most interesting
> thing in the interface, because watching a practitioner decide to stay out of
> it tells you more than watching one talk.

```tsx
<div className={`bid ${b.id} ${b.score >= FLOOR_THRESHOLD ? "in" : "out"}`}>
  <Avatar id={b.id} size={20} />
  <span className="bid-name">{b.name}</span>
  <span className="bid-bar"><i style={{ width: `${b.score}%` }} /></span>
  <span className="bid-score">{b.score}</span>
  <span className="bid-reason">{b.reason}</span>
</div>
```

The bars that fall short are greyed out. That is the room's decision-making,
rendered.

## 4. `App.tsx` becomes two tabs

```tsx
// App.tsx — the shell. Two ways to use the same four practitioners and the
// same memory on disk: one at a time, or all of them in a room together.
import { useState } from "react";
import Solo from "./Solo";
import Room from "./Room";

export default function App() {
  // #room deep-links straight into the panel — handy for a demo, and for
  // opening the thing you actually want to show someone.
  const [view, setView] = useState<"solo" | "room">(
    typeof location !== "undefined" && location.hash === "#room" ? "room" : "solo",
  );

  return (
    <div className="shell">
      <nav className="views">
        <button className={view === "solo" ? "on" : ""} onClick={() => { setView("solo"); location.hash = ""; }}>
          one to one
        </button>
        <button className={view === "room" ? "on" : ""} onClick={() => { setView("room"); location.hash = "#room"; }}>
          the room
        </button>
      </nav>
      {view === "solo" ? <Solo /> : <Room />}
    </div>
  );
}
```

`location.hash === "#room"` deep-links straight into the panel, which is useful
for a demo and for opening the thing you actually want to show someone.

## 5. Two CSS bugs worth teaching

These both came from rendering the page and *looking* at it, not from reading
the code.

**The composer fell off the bottom of the window.**

```css
.chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.scroll { flex: 1; min-height: 0; overflow-y: auto; }
```

`min-height: 0` on both. A flex child defaults to `min-height: auto`, which
means it **refuses to shrink below its content** — so the scrollback grew to fit
the transcript instead of scrolling, and pushed the composer out of view. This
is the single most common CSS flexbox bug and it is worth a slide.

The other half of it:

```css
.shell > .app { height: auto; flex: 1; min-height: 0; }
```

`.app` still carried `height: 100vh` from session 6, when it was the whole page.
Inside the new shell, with a tab strip above it, `100vh` overflows by exactly
the height of the tabs.

**The entry animation left turns faded.**

```css
animation: rise .32s ease-out both;
```

Without `both`, an animation that is interrupted by a re-render leaves the
element at its *starting* opacity. With it, the end state sticks.

---

## Making a screenshot worth posting

If you want a picture of this for a talk or a post:

- open `http://127.0.0.1:3488/#room`
- run a real conversation until the room hands the floor back
- capture around 1500×950

The frame that explains the whole idea is the pinned bid strip with two bars lit
and two greyed out. That single image says: *these are four independent agents,
and two of them just decided not to speak.*

---

## Where to take it next

- **`state.json` is one file for one user.** Making it per-user is the natural
  next step and forces a real conversation about identity and storage.
- **`panel` is one process-wide instance.** Two browsers share a room right
  now. Is that a bug or a feature? (It is a very good feature, and it is two
  lines from being a real group session.)
- **Nobody in the room searched the EMDR claim** in testing, because
  practitioners are told that looking things up stops the room. The 1:1 mentor
  checks claims correctly. That trade-off is a genuine design question, not a
  bug — have the class argue it.
- **Every prompt in this project was changed at least once because of an
  observed failure.** Keep a scripted conversation and re-run it after prompt
  edits. You now know from session 4 that adding good text in one place can
  break behaviour somewhere else, silently.

---

## What you built

An agent with a persistent memory that outlives the process; tool calling with
streamed argument reassembly; cancellation that reaches every piece of I/O; a
core that runs unmodified behind a terminal, an HTTP server and a React app;
live web search with real citations; a hard boundary that produces a phone
number instead of a disclaimer; and a multi-agent conversation whose turn-taking
is decided by parallel bidding, with the rules that the model could not be
trusted to follow enforced in code.

The last one is the idea worth keeping. **Use the model for judgement. Use code
for rules.** Almost everything that went wrong in this project went wrong
because that line was in the wrong place.
