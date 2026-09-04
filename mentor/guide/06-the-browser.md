# Session 6 — The browser

**You will build:** the same agent, in a tab, with its memory visible on the
right — and you will not edit `mentor.ts` to do it.

**New folder:** `mentor-gui/`, alongside `mentor-agent/`.

---

## The claim being tested

Session 3 split the core from the interface and the acceptance test was a grep.
This session is the real test: a web server imports `mentor.ts` and `tools.ts`
**without modifying them**, and the browser and the terminal become two views of
one agent. A goal you commit to in the terminal appears in the browser sidebar,
and the mentor holds you to it in either place.

If that works, the split was real. If it does not, you learn that a "clean
architecture" nobody ever exercised was decoration.

## 1. The folder

```bash
cd ..                       # you should now be beside mentor-agent/
mkdir -p mentor-gui/server mentor-gui/client/src
cd mentor-gui
npm init -y
npm install openai
npm install -D typescript tsx @types/node
```

`mentor-gui/package.json`:

```json
{
  "name": "mentor-gui",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "cd client && npm install --silent && npm run build",
    "start": "tsx server/server.ts",
    "gui": "npm run build && npm run start"
  }
}
```

## 2. `server/server.ts`

```ts
// server.ts — the mentor GUI backend.
//
// It imports mentor-agent/mentor.ts and tools.ts WITHOUT MODIFYING THEM. The
// browser and the terminal run the same agent, the same prompt and the same
// state.json — the only difference is what draws the output.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // mentor-gui/
const AGENT = path.resolve(ROOT, "../mentor-agent");
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const PORT = Number(process.env.PORT ?? 3488);

// Load the API key from the agent's .env — the same file the CLI uses.
const envFile = path.join(AGENT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ---- the unmodified agent core ------------------------------------------
const { Mentor, MODEL } = await import(pathToFileURL(path.join(AGENT, "mentor.ts")).href);
const { readState } = await import(pathToFileURL(path.join(AGENT, "tools.ts")).href);
const { MODALITIES, DEFAULT_MODALITY, isModalityId } =
  await import(pathToFileURL(path.join(AGENT, "modalities.ts")).href);

type AnyMentor = InstanceType<typeof Mentor>;
let mentor: AnyMentor = new Mentor(DEFAULT_MODALITY);

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res: http.ServerResponse, body: unknown, code = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function state() {
  return {
    model: MODEL,
    busy: mentor.busy,
    modality: mentor.modality,
    flagLabel: MODALITIES[mentor.modality as keyof typeof MODALITIES].flagLabel,
    memory: readState(),
    // Skip the system prompt, the tool plumbing, and the injected lens-switch
    // notes — the UI shows the conversation, not the wiring.
    messages: mentor.messages.slice(1)
      .filter((m: any) => m.role !== "tool" && m.role !== "system"
                       && typeof m.content === "string" && m.content)
      .map((m: any) => ({ role: m.role, content: m.content })),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = url.pathname;

  try {
    if (route === "/api/state") return json(res, state());


    if (route === "/api/modalities") {
      return json(res, Object.values(MODALITIES).map((m: any) => ({
        id: m.id, name: m.name, blurb: m.blurb, flagLabel: m.flagLabel,
      })));
    }

    // Switching lens keeps the conversation. The new stance inherits everything
    // already said and has to answer for it.
    if (route === "/api/modality" && req.method === "POST") {
      const { id } = await readBody(req);
      if (!isModalityId(id)) return json(res, { error: `unknown modality: ${id}` }, 400);
      if (mentor.busy) return json(res, { error: "a turn is already running" }, 409);
      mentor.setModality(id);
      return json(res, state());
    }

    if (route === "/api/reset" && req.method === "POST") {
      // Resets the CONVERSATION, not the memory. Goals and beliefs survive on
      // purpose — you don't get to escape a commitment by refreshing the page.
      mentor.interrupt();
      mentor = new Mentor(mentor.modality);   // keep the chosen lens
      return json(res, state());
    }

    if (route === "/api/interrupt" && req.method === "POST") {
      return json(res, { interrupted: mentor.interrupt() });
    }

    if (route === "/api/send" && req.method === "POST") {
      const { text } = await readBody(req);
      if (mentor.busy) return json(res, { error: "a turn is already running" }, 409);

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ type: "start" });

      // Closing the tab must cancel the turn, or we keep paying for tokens
      // nobody will read. Same rule as Ctrl+C, different gesture.
      res.on("close", () => { if (mentor.busy) mentor.interrupt(); });

      try {
        const turn = await mentor.send(String(text ?? ""), {
          onFirstToken: (ms: number) => send({ type: "ttft", ms }),
          onDelta: (delta: string) => send({ type: "delta", text: delta }),
          onTool: (event: unknown) => send({ type: "tool", event }),
        });
        send({ type: "done", interrupted: turn.interrupted, ms: turn.ms, state: state() });
      } catch (err) {
        send({ type: "error", message: (err as Error).message, state: state() });
      }
      return res.end();
    }

    // ---- static client ----
    const file = route === "/" ? "/index.html" : route;
    const abs = path.join(CLIENT_DIST, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const types: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
        ".svg": "image/svg+xml", ".json": "application/json",
      };
      res.writeHead(200, { "content-type": types[path.extname(abs)] ?? "application/octet-stream" });
      return fs.createReadStream(abs).pipe(res);
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end(fs.existsSync(CLIENT_DIST) ? "not found" : "client not built — run: npm run build");
  } catch (err) {
    json(res, { error: (err as Error).message }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  mentor gui  ·  http://127.0.0.1:${PORT}`);
  console.log(`  model ${MODEL}  ·  core imported from mentor-agent/\n`);
});
```

Start it with `npm run start`. It will say the client is not built yet, which is
true. Check the API works first:

```bash
curl -s localhost:3488/api/state | head -c 200
curl -s -X POST localhost:3488/api/send \
  -H 'content-type: application/json' -d '{"text":"hello"}'
```

### What each part is doing

#### Importing the core across a folder boundary

```ts
const { Mentor, MODEL } = await import(pathToFileURL(path.join(AGENT, "mentor.ts")).href);
```

A dynamic `import()` with an absolute path, because `mentor-agent/` is a
separate package and there is no build step to link them. `pathToFileURL` is
required — on Windows a bare path is not a valid module specifier, and this is
the kind of thing that works on your laptop and fails in class.

The trade-off is honest: the import is untyped, hence `type AnyMentor =
InstanceType<typeof Mentor>` and a few `any`s. In a monorepo you would use
workspaces and keep the types. This shape is chosen so the two folders stay
independently runnable.

#### Loading `.env` by hand

```ts
const envFile = path.join(AGENT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
```

Eight lines instead of a dependency, and it reads the **agent's** `.env` — one
key, one file, for both applications. Note `!process.env[m[1]]`: a real
environment variable beats the file, which is how deployment overrides work.

#### `state()` decides what the browser is allowed to see

```ts
messages: mentor.messages.slice(1)
  .filter((m: any) => m.role !== "tool" && m.role !== "system"
                   && typeof m.content === "string" && m.content)
  .map((m: any) => ({ role: m.role, content: m.content })),
```

`slice(1)` drops the system prompt. The filter drops tool plumbing and the
injected lens-switch notes. The `.map` rebuilds each message with only the two
fields the UI needs.

That last step is the one students skip. **Do not send your internal objects to
the client.** Here the system prompt contains everything the mentor knows about
the user, and shipping it to the browser because it happened to be in the same
array is exactly how data leaks. Choose what crosses the boundary, deliberately,
in one function.

#### Streaming over HTTP: server-sent events

```ts
res.writeHead(200, {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
});
const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
```

SSE is the whole protocol: `data: ` + JSON + **two** newlines per event, over a
response you never end. One blank line means nothing arrives.

The handlers from session 3 map straight onto it:

```ts
const turn = await mentor.send(String(text ?? ""), {
  onFirstToken: (ms: number) => send({ type: "ttft", ms }),
  onDelta: (delta: string) => send({ type: "delta", text: delta }),
  onTool: (event: unknown) => send({ type: "tool", event }),
});
send({ type: "done", interrupted: turn.interrupted, ms: turn.ms, state: state() });
```

`onDelta` was `stdout.write` in the terminal. Same core, same call, different
sink. This is the payoff for session 3, and it is worth saying so out loud.

Why not WebSockets? Nothing here needs to go client→server mid-turn. SSE is
one-directional, survives proxies, reconnects on its own, and needs no library.
Session 8 will need a *persistent* stream and will still not need WebSockets.

#### Closing the tab cancels the turn

```ts
res.on("close", () => { if (mentor.busy) mentor.interrupt(); });
```

Same `interrupt()` as Ctrl+C, different gesture. Without this, closing a tab
leaves the model generating tokens nobody will read and you pay for all of them.
Cancellation is a cost control, not only a UX feature.

#### Reset clears the conversation, not the memory

```ts
mentor = new Mentor(mentor.modality);   // keep the chosen lens
```

> **What went wrong.** This was `new Mentor()` at first, so "new conversation"
> silently threw you back to CBT. A default parameter is a decision, and it will
> be made for you if you do not make it.

Goals and beliefs survive on purpose: **you do not get to escape a commitment by
refreshing the page.**

#### Path traversal in the static handler

```ts
const abs = path.join(CLIENT_DIST, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
```

Without the `replace`, a request for `/../../../../etc/passwd` reads whatever
the process can read. Any time you build a filesystem path out of a URL, this
is the bug. Worth two minutes even though the app is bound to `127.0.0.1`.

## 3. The client

```bash
cd client
npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

`client/package.json` — note `"type": "module"`, same as the other two
packages:

```json
{
  "name": "mentor-gui-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" }
}
```

`client/tsconfig.json` — different from the agent's, because this code runs in
a browser rather than in Node:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`"lib"` gains the DOM types and `"types"` drops `node` — a browser has no `fs`.
`"jsx": "react-jsx"` is what lets you write JSX without importing React in
every file.

`client/vite.config.ts` — the proxy is what lets `npm run dev` talk to the API
on 3488 while Vite serves the UI on 5173:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:3488" } },
});
```

`client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mentor — a room of psychologists that disagree</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`client/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`client/src/App.tsx` — for now, just the one view. Session 8 turns this into
tabs:

```tsx
import Solo from "./Solo";

export default function App() {
  return <Solo />;
}
```

### `client/src/ToolReceipt.tsx`

```tsx
// ToolReceipt.tsx — what a tool call looks like when it happens.
//
// Watching the write is the point of the interface: a commitment becoming a
// record, a claim being checked. A search that shows no sources is just the
// model asserting things again, so the links are part of the receipt rather
// than a detail tucked away in the model's context.
import type { JSX } from "react";

interface Source { title: string; url: string }

export interface ToolEvent {
  name: string;
  args: Record<string, any>;
  label: string;
  sources?: Source[];
}

// A magnifier drawn rather than typed: the Unicode one (U+2315) renders as an
// illegible dot at this size in most fonts.
const MAGNIFIER = (
  <svg viewBox="0 0 14 14" width="12" height="12" fill="none"
       stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="4" />
    <path d="M9 9 L12.5 12.5" />
  </svg>
);

const ICON: Record<string, JSX.Element | string> = {
  record_goal: "\u25ce",
  update_goal: "\u2713",
  flag_limiting_belief: "\u25b3",
  web_search: MAGNIFIER,
  find_support: MAGNIFIER,
};

/** update_goal is coloured by outcome, not by which tool ran. */
function variant(t: ToolEvent): string {
  if (t.name !== "update_goal") return t.name;
  return `update_goal ${t.args.status ?? ""}`;
}

export default function ToolReceipt({ event }: { event: ToolEvent }) {
  return (
    <div className={`tool ${variant(event)}`}>
      <div className="tool-line">
        <span className="tool-icon">{ICON[event.name] ?? "\u2022"}</span>
        {event.label}
      </div>
      {!!event.sources?.length && (
        <div className="sources">
          {event.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
              {s.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

The receipt is the point of this interface. Watching a commitment get written
down is what makes it a commitment, and a search with no visible sources is
just the model asserting things again — so the links are part of the receipt
rather than a detail hidden in the model's context.

### `client/src/RichText.tsx`

```tsx
// RichText.tsx — the small amount of markup a language model actually emits.
//
// Bodies are rendered as plain text with pre-wrap, which is right for a
// transcript. But a model that has just searched the web writes its citations
// as [label](url), and telling it not to is a rule it will forget by the third
// turn. Linkifying on the way out is the fix that stays fixed.
import type { ReactNode } from "react";

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()\[\]]+)/g;

export default function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  LINK.lastIndex = 0;
  while ((m = LINK.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const url = m[2] ?? m[3];
    const label = m[1] ?? m[3].replace(/^https?:\/\//, "").replace(/\/$/, "");
    out.push(
      <a key={m.index} href={url} target="_blank" rel="noreferrer noopener" title={url}>
        {label}
      </a>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));

  return <>{out}</>;
}
```

> **What went wrong.** After session 5 the mentor started citing sources, and it
> writes citations as markdown: `[label](url)`. The transcript is plain text
> with `white-space: pre-wrap`, so they rendered as literal brackets. You could
> tell the model not to use markdown — and it will forget by the third turn.
> Linkifying on the way out is the fix that stays fixed.

### `client/src/Solo.tsx`

```tsx
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
```

### `client/src/app.css`

Paste this whole file. It is the complete stylesheet for both views — the
room-specific half at the bottom does nothing until session 8.

```css
:root {
  --bg: #0e0e11;
  --panel: #16161b;
  --panel-2: #1c1c23;
  --line: #2a2a33;
  --text: #e6e6ea;
  --muted: #8b8b98;
  --violet: #a78bfa;
  --amber: #e0a352;
  --blue: #6ba8e8;
  --red: #e06c75;
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

.app {
  display: grid;
  grid-template-columns: 1fr 340px;
  height: 100vh;
}

/* ---- chat column ---- */
.chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 22px;
  border-bottom: 1px solid var(--line);
}

.brand { font-weight: 650; color: var(--violet); letter-spacing: .2px; }
.sub { color: var(--muted); font-size: 13px; margin-left: 10px; }
.bar-right { display: flex; align-items: center; gap: 12px; }
.model { color: var(--muted); font-size: 12px; font-family: ui-monospace, monospace; }

button {
  font: inherit;
  border-radius: 7px;
  cursor: pointer;
  transition: background .15s, border-color .15s, opacity .15s;
}
button:disabled { opacity: .4; cursor: not-allowed; }

.ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
  padding: 5px 11px;
}
.ghost:hover:not(:disabled) { border-color: var(--muted); color: var(--text); }

.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 26px 22px; }

.empty { max-width: 460px; margin: 14vh auto; color: var(--muted); text-align: center; }
.empty-title { color: var(--text); font-size: 17px; font-weight: 600; margin-bottom: 10px; }
.empty-hint { color: var(--violet); margin-top: 18px; }

.msg { max-width: 720px; margin: 0 auto 24px; }
.who {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .09em;
  color: var(--muted);
  margin-bottom: 6px;
}
.msg.assistant .who { color: var(--violet); }
.body { white-space: pre-wrap; word-wrap: break-word; }
.msg.user .body {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 11px 14px;
}
.thinking { color: var(--muted); font-style: italic; }

/* Links the model wrote into its own reply, usually citations after a search. */
.body a {
  color: #7fd0dd;
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, #7fd0dd 38%, transparent);
}
.body a:hover { border-bottom-color: #7fd0dd; }

/* ---- tool receipts ---- */
.tools { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.tool {
  display: block;
  font-size: 13px;
  padding: 7px 12px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel);
  animation: slide-in .3s ease-out;
}
.tool-icon { font-size: 12px; }
.tool-line { display: flex; align-items: center; gap: 9px; }
.tool-line svg { flex: none; }
.tool.record_goal { color: var(--blue); border-color: color-mix(in srgb, var(--blue) 35%, var(--line)); }
.tool.flag_limiting_belief { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 35%, var(--line)); }
.tool.update_goal { color: var(--muted); }
.tool.update_goal.kept { color: #61c795; border-color: color-mix(in srgb, #61c795 35%, var(--line)); }
.tool.update_goal.missed,
.tool.update_goal.dropped { color: var(--red); border-color: color-mix(in srgb, var(--red) 35%, var(--line)); }
.tool.web_search,
.tool.find_support { color: #5ec8d8; border-color: color-mix(in srgb, #5ec8d8 35%, var(--line)); }

/* A search that shows no sources is the model asserting things again. */
.sources { display: flex; flex-direction: column; gap: 3px; margin: 7px 0 1px 21px; }
.sources a {
  color: var(--muted);
  font-size: 11.5px;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.sources a::before { content: "↗ "; opacity: .6; }
.sources a:hover { color: var(--text); border-bottom-color: var(--line); }

@keyframes slide-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: none; }
}

.error {
  margin: 0 22px 10px;
  padding: 9px 13px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--red) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 40%, transparent);
  color: var(--red);
  font-size: 13px;
}

/* ---- composer ---- */
.composer {
  display: flex;
  gap: 10px;
  padding: 14px 22px 20px;
  border-top: 1px solid var(--line);
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  resize: none;
  font: inherit;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 11px 13px;
}
.composer textarea:focus { outline: none; border-color: var(--violet); }

.send, .stop { border: none; padding: 11px 20px; font-weight: 600; }
.send { background: var(--violet); color: #16161b; }
.stop { background: transparent; border: 1px solid var(--red); color: var(--red); }

/* ---- memory sidebar ---- */
.memory {
  background: var(--panel);
  border-left: 1px solid var(--line);
  overflow-y: auto;
  padding: 18px 18px 40px;
}
.memory-head { padding-bottom: 14px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
.memory-head h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: .2px; }
.memory-head p { margin: 0; font-size: 12px; color: var(--muted); }

.memory section { margin-bottom: 26px; }
.memory h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .09em;
  color: var(--muted);
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.count {
  background: var(--panel-2);
  border-radius: 20px;
  padding: 1px 8px;
  font-size: 11px;
  letter-spacing: 0;
}
.none { color: var(--muted); font-size: 13px; font-style: italic; margin: 0; }

.card {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line);
  border-radius: 8px;
  padding: 11px 12px;
  margin-bottom: 9px;
  font-size: 13px;
}
.card.goal { border-left-color: var(--blue); }
.card.belief { border-left-color: var(--amber); }
.card.fresh { animation: flash 1.4s ease-out; }

@keyframes flash {
  0%   { background: color-mix(in srgb, var(--violet) 26%, var(--panel-2)); }
  100% { background: var(--panel-2); }
}

.card-main { line-height: 1.45; }
.card-why, .card-date, .deadline, .distortion { font-size: 11.5px; margin-top: 5px; }

/* A record that only ever grows is a list of things nobody followed up on. */
.status {
  display: inline-block;
  margin-top: 6px;
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  border-radius: 20px;
  padding: 1px 8px;
  border: 1px solid currentColor;
}
.status.kept { color: #61c795; }
.status.missed { color: var(--red); }
.status.dropped { color: var(--muted); }
.card.goal.kept { border-left-color: #61c795; }
.card.goal.missed { border-left-color: var(--red); }
.card.goal.dropped { border-left-color: var(--muted); opacity: .7; }
.card-why { color: var(--muted); }
.card-date { color: #5f5f6d; }
.deadline { color: var(--blue); font-family: ui-monospace, monospace; }
.distortion { color: var(--amber); text-transform: lowercase; }

@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
  .memory { border-left: none; border-top: 1px solid var(--line); max-height: 42vh; }
}

/* ---- lens picker ---- */
.lens {
  font: inherit;
  font-size: 13px;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 5px 9px;
  max-width: 290px;
  cursor: pointer;
}
.lens:hover:not(:disabled) { border-color: var(--violet); }
.lens:disabled { opacity: .5; cursor: not-allowed; }
.lens:focus { outline: none; border-color: var(--violet); }

/* The transcript marker showing where the lens changed. */
.switch-marker {
  max-width: 720px;
  margin: 0 auto 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--violet);
  font-size: 12px;
  text-transform: lowercase;
  letter-spacing: .04em;
}
.switch-marker::before,
.switch-marker::after {
  content: "";
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--violet) 30%, transparent);
}

.empty-lens { font-size: 13px; margin-top: 14px; }

/* ============================================================
   the room
   ============================================================ */

/* One colour per practitioner. It is set once on the row and everything
   inside — avatar, name, rule, bid bar — inherits it through currentColor. */
:root {
  --cbt: #6ba8e8;
  --istdp: #e8737f;
  --analytical: #b092fb;
  --behavioral: #61c795;
  --serif: ui-serif, Iowan Old Style, Palatino, Georgia, serif;
}

.shell { height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.shell > .app { height: auto; flex: 1; min-height: 0; }

/* A room is a darker, quieter place than the 1:1 view. */
.shell:has(.chat .brand-block) {
  background:
    radial-gradient(1100px 620px at 22% -12%, #1a1a24 0%, transparent 62%),
    radial-gradient(760px 460px at 105% 8%, #191a21 0%, transparent 58%),
    var(--bg);
}

/* ---- view tabs ---- */
.views {
  display: flex;
  gap: 3px;
  padding: 9px 22px 0;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 70%, transparent);
}
.views button {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  letter-spacing: .03em;
  padding: 8px 16px;
  margin-bottom: -1px;
}
.views button:hover { color: var(--text); }
.views button.on {
  color: var(--text);
  background: var(--bg);
  border-color: var(--line);
}

/* ---- avatars ---- */
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 50%;
  background: color-mix(in srgb, currentColor 11%, var(--panel));
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
}
.avatar.user { color: var(--muted); }
.avatar.cbt { color: var(--cbt); }
.avatar.istdp { color: var(--istdp); }
.avatar.analytical { color: var(--analytical); }
.avatar.behavioral { color: var(--behavioral); }

/* ---- header ---- */
.brand-block { display: flex; align-items: center; gap: 15px; }
.faces { display: flex; }
.faces .face { margin-right: -7px; border-radius: 50%; transition: transform .2s, margin .2s; }
.faces .face:last-child { margin-right: 0; }
.faces .face .avatar { box-shadow: 0 0 0 3px var(--bg); }
.faces:hover .face { margin-right: 3px; }
.faces .face.live .avatar {
  box-shadow: 0 0 0 3px var(--bg), 0 0 0 5px color-mix(in srgb, currentColor 45%, transparent);
}
.brand-block .brand { font-family: var(--serif); font-weight: 600; font-size: 16px; }

/* ---- a turn ---- */
.turn {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 15px;
  max-width: 760px;
  margin: 0 auto 26px;
  animation: rise .32s ease-out both;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

.turn.you { color: var(--muted); }
.turn.cbt { color: var(--cbt); }
.turn.istdp { color: var(--istdp); }
.turn.analytical { color: var(--analytical); }
.turn.behavioral { color: var(--behavioral); }

.turn .who {
  font-family: var(--serif);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .01em;
  text-transform: none;
  color: currentColor;
  margin-bottom: 5px;
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.turn .school {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: .11em;
  text-transform: uppercase;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 1px 7px;
}
.turn .body {
  color: var(--text);
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.68;
}
.turn.you .body {
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  border: 1px solid var(--line);
  border-radius: 3px 11px 11px 11px;
  padding: 11px 14px;
}
.turn.live .avatar {
  animation: breathe 1.9s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 34%, transparent); }
  50%      { box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 0%, transparent); }
}
.cutoff { color: var(--amber); font-style: italic; font-size: 13px; }

/* ---- the floor ----
   Everyone's private wish to speak, made visible. The bars that fall short are
   the interesting ones: that is a clinician deciding to stay out of it. */
.bids {
  max-width: 760px;
  margin: 0 auto;
  width: 100%;
  padding: 13px 16px 9px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--panel) 78%, transparent),
    color-mix(in srgb, var(--panel) 34%, transparent));
}
.bids-head {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .13em;
  color: var(--muted);
  margin-bottom: 12px;
}
.bid {
  display: grid;
  grid-template-columns: 20px 58px 132px 26px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  font-size: 12px;
  margin-bottom: 7px;
}
.bid.cbt { color: var(--cbt); }
.bid.istdp { color: var(--istdp); }
.bid.analytical { color: var(--analytical); }
.bid.behavioral { color: var(--behavioral); }
.bid-name { color: var(--text); font-family: var(--serif); font-size: 13px; }
.bid-bar {
  height: 5px;
  background: color-mix(in srgb, var(--panel-2) 90%, transparent);
  border-radius: 3px;
  overflow: hidden;
}
.bid-bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: currentColor;
  transition: width .45s cubic-bezier(.2,.8,.3,1);
}
.bid.out { opacity: .42; }
.bid-score { color: var(--muted); font-family: ui-monospace, monospace; font-size: 11px; text-align: right; }
.bid-reason {
  color: var(--muted);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floor-strip {
  padding: 12px 22px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.floor-note {
  max-width: 760px;
  margin: 0 auto;
  color: var(--muted);
  font-size: 12.5px;
  text-align: center;
  font-style: italic;
}
.floor-note::before,
.floor-note::after { content: " · "; opacity: .5; }

.cut {
  border: none;
  padding: 11px 20px;
  font-weight: 600;
  background: var(--amber);
  color: #16161b;
}

/* ---- the roster ---- */
.member {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}
.member:last-child { border-bottom: none; }
.member.cbt { color: var(--cbt); }
.member.istdp { color: var(--istdp); }
.member.analytical { color: var(--analytical); }
.member.behavioral { color: var(--behavioral); }
.member-name {
  font-family: var(--serif);
  font-size: 14px;
  font-weight: 600;
  color: currentColor;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.member-name .school {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: .11em;
  text-transform: uppercase;
  color: var(--muted);
}
.member-blurb { color: var(--muted); font-size: 12px; margin-top: 2px; }
.member.live .avatar { animation: breathe 1.9s ease-in-out infinite; }
.member.live .member-blurb::after { content: " · speaking"; color: var(--text); }

/* Records are colour-coded by who wrote them, not by what kind they are. */
.card.cbt { border-left-color: var(--cbt); }
.card.istdp { border-left-color: var(--istdp); }
.card.analytical { border-left-color: var(--analytical); }
.card.behavioral { border-left-color: var(--behavioral); }

@media (max-width: 900px) {
  .turn { grid-template-columns: 30px minmax(0, 1fr); gap: 11px; }
  .bid { grid-template-columns: 20px 54px 1fr 26px; }
  .bid-reason { display: none; }
}
```

Then:

```bash
cd .. && npm run gui
```

---

## What to point out in the client

### Parsing SSE by hand

```ts
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";      // the last piece may be half an event
  ...
}
```

Note `buffer` and that `pop()`. A chunk off the network is **not** a whole SSE
event — it can split one in half. Everything before the last `\n\n` is complete;
whatever follows goes back in the buffer to be finished by the next chunk.
Forget this and it works on localhost and breaks over a real network, which is
the worst kind of bug.

`decoder.decode(value, { stream: true })` matters for the same reason at the
byte level: a multi-byte character can be split across chunks.

Why not `EventSource`? Because `EventSource` only does GET, and this is a POST
with a JSON body. Session 8 uses a GET stream and will use `EventSource`.

### Immutable updates during streaming

```ts
setMessages((m) => {
  const next = [...m];
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, content: last.content + ev.text };
  return next;
});
```

Verbose on purpose: `next[i].content += ev.text` mutates the object React is
holding, `Object.is` sees no change, and nothing re-renders. This runs once per
token, so it is also where students first meet React's rendering cost.

### The optimistic placeholder

```ts
setMessages((m) => [...m, { role: "user", content: text },
                         { role: "assistant", content: "", tools: [] }]);
```

Both messages go in before the request. The empty assistant message is the thing
the deltas will fill in — it exists so there is always a `last` to append to,
and so "thinking…" has somewhere to live.

---

## The test that matters

1. In the browser, commit to something. Watch the receipt appear and the
   sidebar update.
2. Quit the browser. In `mentor-agent/`, run `npm run dev`.
3. Type `/state`.

Your commitment is there, and the terminal mentor will hold you to it. Two
interfaces, one agent, one memory, and `mentor.ts` was never opened.

---

## Exercises

1. Run the terminal and the browser at once and commit in each. Explain why
   `state.json` is fine here and would not be with ten users.
2. Add `ttft` to the UI from the event that is already being sent.
3. Kill the server mid-answer. Make the client say something honest.

---

**Next:** [Session 7 — The room](07-the-room.md), where four practitioners have
to work out who speaks next.
