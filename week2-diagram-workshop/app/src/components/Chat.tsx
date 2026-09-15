import { useState } from "react";

// The chat panel. Deliberately small — this workshop is about the agent, not
// about a message list.
//
// The one idea worth taking from it: a tool call is part of the transcript,
// not a hidden implementation detail. When the agent calls addElements, the
// user sees "addElements" appear in the conversation. An agent that redraws
// your canvas with no visible reason feels broken even when it is right.
interface Part {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface Message {
  id: string;
  role: string;
  parts?: Part[];
}

const toolName = (part: Part) =>
  part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null;

export default function Chat({
  messages,
  sendMessage,
  status,
}: {
  messages: Message[];
  sendMessage: (message: { role: "user"; parts: { type: "text"; text: string }[] }) => void;
  status: string;
}) {
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }

  return (
    <aside className="chat">
      <header>
        <b>Diagram agent</b>
        <span className={busy ? "dot busy" : "dot"} />
      </header>

      <div className="log">
        {messages.length === 0 && (
          <p className="hint">
            Try: <em>draw a sequence diagram of an OAuth login</em>
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {(m.parts ?? []).map((part, i) => {
              if (part.type === "text") return <p key={i}>{part.text}</p>;
              const tool = toolName(part);
              if (!tool) return null;
              return (
                <code key={i} className="tool">
                  {tool}
                </code>
              );
            })}
          </div>
        ))}
        {busy && <div className="msg assistant thinking">…</div>}
      </div>

      <div className="composer">
        <textarea
          value={input}
          placeholder={busy ? "drawing…" : "What should I draw?"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button onClick={submit} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </aside>
  );
}
