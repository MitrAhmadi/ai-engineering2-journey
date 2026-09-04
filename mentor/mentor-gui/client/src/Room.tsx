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
