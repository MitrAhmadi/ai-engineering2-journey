import { useEffect, useRef, useState } from "react";
import ToolReceipt, { type ToolEvent } from "./ToolReceipt";
import RichText from "./RichText";

interface Message {
  role: string;
  content: string;
  /** Tool events that fired during this assistant turn. */
  tools?: ToolEvent[];
}

interface Goal {
  goal: string;
  why: string;
  deadline?: string;
  recordedAt: string;
  modality?: string;
  status?: string;
  outcome?: string;
}

interface Belief {
  belief: string;
  distortion: string;
  counterEvidence?: string;
  recordedAt: string;
  modality?: string;
}

interface Memory {
  goals: Goal[];
  beliefs: Belief[];
}

interface ModalityInfo {
  id: string;
  name: string;
  blurb: string;
  flagLabel: string;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function Solo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [memory, setMemory] = useState<Memory>({ goals: [], beliefs: [] });
  const [model, setModel] = useState("");
  const [modalities, setModalities] = useState<ModalityInfo[]>([]);
  const [modality, setModality] = useState("cbt");
  const [flagLabel, setFlagLabel] = useState("Limiting beliefs");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Goals/beliefs that arrived this session, for the highlight animation. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then((s) => {
      setMessages(s.messages);
      setMemory(s.memory);
      setModel(s.model);
      setModality(s.modality);
      setFlagLabel(s.flagLabel);
    }).catch(() => setError("could not reach the server"));

    fetch("/api/modalities").then((r) => r.json()).then(setModalities).catch(() => {});
  }, []);

  // Switching lens keeps the conversation — the new stance has to answer for
  // everything already said. A marker in the transcript shows where it changed.
  async function switchModality(id: string) {
    if (id === modality || busy) return;
    const res = await fetch("/api/modality", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const s = await res.json();
    if (s.error) return setError(s.error);
    setModality(s.modality);
    setFlagLabel(s.flagLabel);
    setMessages((m) => [...m, { role: "switch", content: modalities.find((x) => x.id === id)?.name ?? id }]);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text },
                             { role: "assistant", content: "", tools: [] }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error((await res.json()).error ?? "request failed");

      // Parse the SSE stream by hand — it's four lines, and it avoids pulling
      // in a dependency for a format this simple.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const ev = JSON.parse(frame.slice(6));

          if (ev.type === "delta") {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + ev.text };
              return next;
            });
          } else if (ev.type === "tool") {
            // The write is shown the moment it happens. Watching a commitment
            // get recorded is the point of the whole interface.
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, tools: [...(last.tools ?? []), ev.event] };
              return next;
            });
            const key = ev.event.args.goal ?? ev.event.args.belief;
            if (key) setFresh((f) => new Set(f).add(key));
          } else if (ev.type === "done") {
            setMemory(ev.state.memory);
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function stop() {
    fetch("/api/interrupt", { method: "POST" });
    abortRef.current?.abort();
  }

  async function reset() {
    const s = await (await fetch("/api/reset", { method: "POST" })).json();
    setMessages(s.messages);
    setMemory(s.memory);
    setModality(s.modality);
    setFlagLabel(s.flagLabel);
    setError("");
  }

  return (
    <div className="app">
      <main className="chat">
        <header className="bar">
          <div>
            <span className="brand">mentor</span>
            <span className="sub">
              {modalities.find((m) => m.id === modality)?.blurb ?? "accountability partner"}
            </span>
          </div>
          <div className="bar-right">
            <select
              className="lens"
              value={modality}
              disabled={busy}
              title={modalities.find((m) => m.id === modality)?.blurb}
              onChange={(e) => switchModality(e.target.value)}
            >
              {modalities.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — {m.blurb}</option>
              ))}
            </select>
            <span className="model">{model}</span>
            <button className="ghost" onClick={reset} disabled={busy}>new conversation</button>
          </div>
        </header>

        <div className="scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <p className="empty-title">This is not a chatbot that agrees with you.</p>
              <p>
                It challenges the pattern instead of soothing it, refuses to hand you
                easy answers, and writes down every commitment you make so it can hold
                you to it later.
              </p>
              <p className="empty-lens">
                Four lenses in the dropdown, four different theories of why you're stuck.
                Switch mid-conversation and the same story gets read a different way.
              </p>
              <p className="empty-hint">Tell it what you're avoiding.</p>
            </div>
          )}

          {messages.map((m, i) => m.role === "switch" ? (
            <div key={i} className="switch-marker">
              <span>now working as {m.content}</span>
            </div>
          ) : (
            <div key={i} className={`msg ${m.role}`}>
              <div className="who">{m.role === "user" ? "you" : "mentor"}</div>
              <div className="body">
                <RichText text={m.content} />
                {busy && i === messages.length - 1 && !m.content && (
                  <span className="thinking">thinking…</span>
                )}
              </div>
              {!!m.tools?.length && (
                <div className="tools">
                  {m.tools.map((t, j) => <ToolReceipt key={j} event={t} />)}
                </div>
              )}
            </div>
          ))}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="composer">
          <textarea
            ref={inputRef}
            value={input}
            placeholder="What are you avoiding?"
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          {busy
            ? <button className="stop" onClick={stop}>stop</button>
            : <button className="send" onClick={send} disabled={!input.trim()}>send</button>}
        </div>
      </main>

      <aside className="memory">
        <div className="memory-head">
          <h2>What it remembers</h2>
          <p>Survives refreshes, restarts and new conversations.</p>
        </div>

        <section>
          <h3>Goals <span className="count">{memory.goals.length}</span></h3>
          {memory.goals.length === 0 && <p className="none">Nothing committed to yet.</p>}
          {memory.goals.map((g, i) => (
            <div key={i} className={`card goal ${g.status ?? "open"} ${fresh.has(g.goal) ? "fresh" : ""}`}>
              <div className="card-main">{g.goal}</div>
              {g.status && g.status !== "open" && <span className={`status ${g.status}`}>{g.status}</span>}
              {g.deadline && <div className="deadline">{g.deadline}</div>}
              <div className="card-why">{g.outcome ?? g.why}</div>
              <div className="card-date">{fmtDate(g.recordedAt)}{g.modality ? ` · ${g.modality}` : ""}</div>
            </div>
          ))}
        </section>

        <section>
          <h3>{flagLabel} <span className="count">{memory.beliefs.length}</span></h3>
          {memory.beliefs.length === 0 && <p className="none">None flagged yet.</p>}
          {memory.beliefs.map((b, i) => (
            <div key={i} className={`card belief ${fresh.has(b.belief) ? "fresh" : ""}`}>
              <div className="card-main">“{b.belief}”</div>
              <div className="distortion">{b.distortion}</div>
              {b.counterEvidence && <div className="card-why">counter-evidence: {b.counterEvidence}</div>}
              <div className="card-date">{fmtDate(b.recordedAt)}{b.modality ? ` · ${b.modality}` : ""}</div>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
