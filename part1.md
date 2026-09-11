
mkdir -p src/components src/tools src/canvas src/rag evals/scorers evals/datasets corpus
```

The scripts you will use all week:

**`package.json`** · replace the generated "scripts" block · lines 6–13 of the finished file

```json
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "typecheck": "tsc -b",
    "eval": "dotenv -e .dev.vars -- braintrust eval evals/diagram.eval.ts",
    "eval:local": "dotenv -e .dev.vars -- tsx evals/run.ts",
    "embed": "dotenv -e .dev.vars -- tsx src/rag/embed.ts"
  },
```

**`vite.config.ts`** · new file · 10 lines

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Two runtimes, one dev server. `react()` builds the browser bundle;
// `cloudflare()` runs src/worker.ts inside workerd — the same runtime
// Cloudflare runs in production — and proxies /agents/* to it.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
```

**`wrangler.jsonc`** · new file · 13 lines

```jsonc
{
  "name": "diagram-agent",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./src/worker.ts",
  "assets": { "not_found_handling": "single-page-application" },
  // The agent is a Durable Object: one long-lived instance per session id,
  // with its own SQLite storage for the message history.
  "durable_objects": {
    "bindings": [{ "name": "DesignAgent", "class_name": "DesignAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DesignAgent"] }]
}
```

Only the first key is needed to start; the rest unlock one part each.

**`.dev.vars`** · new file — never commit it · 13 lines

```
# cp .dev.vars.example .dev.vars, then fill in.
OPENAI_API_KEY=sk-...

# Optional. Free tier at https://tavily.com — used by the searchWeb tool (Part 8).
TAVILY_API_KEY=

# Optional. Free tier at https://console.upstash.com/vector — used by RAG (Part 9).
UPSTASH_VECTOR_REST_URL=
UPSTASH_VECTOR_REST_TOKEN=

# Optional. Free tier at https://braintrust.dev — the eval dashboard (Parts 3-10).
# `npm run eval:local` needs no account.
BRAINTRUST_API_KEY=
```

> ### Why Cloudflare, and what a Durable Object buys you
>
> A chat agent needs somewhere to keep the conversation. The usual answer is a
> database plus a session id plus code to load and save. A Durable Object is
> that, collapsed: a single addressable instance per session, with its own
> storage, that stays alive between messages. `AIChatAgent` keeps the message
> history in it for you.
>
> You are not learning Cloudflare for its own sake. You are learning what
> "stateful agent" looks like when the state is not your problem.

**Four `tsconfig` files**, because this project has three runtimes that do not
share types: `tsconfig.json` (a project-references stub that points at the other
three), `tsconfig.app.json` (browser — DOM types, JSX), `tsconfig.worker.json`
(the Worker — `@cloudflare/workers-types`, no DOM) and `tsconfig.node.json` (the
eval scripts — node types). Copy all four from `app/`, along with `index.html`,
`src/main.tsx`, `src/index.css` and `src/App.css`, which are scaffolding rather
than subject matter.

`npm run typecheck` should pass with no source of your own yet.

---

## Part 1 — a canvas, a chat, and an agent with no hands

| file | |
|---|---|
| `src/worker.ts` | new |
| `src/agent.ts` | new — Part 8 adds the turn budget to it |
| `src/agent-core.ts` | new |
| `src/components/Canvas.tsx` | new |
| `src/components/Chat.tsx` | new |
| `src/App.tsx` | new |
| `src/main.tsx`, `src/index.css`, `src/App.css` | new — copy from `app/` |

At the end of this part you can talk to an agent that cannot draw. That sounds
like a waste of a part. It is the opposite: everything hard about the plumbing —
the Durable Object, the websocket, streaming, history — is working and proven
before you add the first tool.

### The Worker

**`src/worker.ts`** · new file · 21 lines

```ts
import { routeAgentRequest } from "agents";
import { DesignAgent } from "./agent";

// The entire Worker. `routeAgentRequest` recognises the /agents/:agent/:name
// URLs the client SDK uses, finds (or creates) the Durable Object for that
// name, and hands the request to it. Anything else is a 404 — in dev, Vite
// serves the React app and only proxies the agent routes here.
export { DesignAgent };

interface Env {
  DesignAgent: DurableObjectNamespace;
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
```

### The agent

**`src/agent.ts`** · new file · 36 lines

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { streamAgent } from "./agent-core";

// The agent is a Durable Object.
//
// That is the whole reason this app runs on Cloudflare rather than a plain
// server. A Durable Object is a single-instance, addressable, stateful worker:
// one per session id, with its own SQLite storage. `AIChatAgent` uses that to
// keep the message history — you do not manage a sessions table, you do not
// pass the transcript back and forth, and two browser tabs on the same id see
// the same conversation.
//
// Everything interesting happens in agent-core.ts. This class is the adapter
// between Cloudflare's runtime and that file: pull the keys out of env, build
// the model, hand over the messages, return the stream.
//
// Part 8 adds one more thing to it — the only piece of safety that cannot live
// anywhere else — once you have seen why it is needed.
interface Env {
  OPENAI_API_KEY: string;
}

export class DesignAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });

    const result = streamAgent({
      model: openai.chat("gpt-5.4"),
      messages: await convertToModelMessages(this.messages),
    });

    return result.toUIMessageStreamResponse();
  }
}
```

### The core

**`src/agent-core.ts`** · new file · 31 lines

```ts
// Part 1's agent core: a streaming chat agent with no tools at all.
//
// Everything in this file survives to the end of the workshop. The parts that
// come later add tools, a simulated canvas for the eval, and a longer prompt —
// but this shape, streamText with a system prompt and a step limit, is the
// agent, and it is already complete.
import { streamText, stepCountIs, type LanguageModel, type ModelMessage } from "ai";

export const SYSTEM_PROMPT = `You are a diagram design assistant. Right now you have no tools,
so you cannot draw anything yet — say so plainly if you are asked to. Be brief.`;

export const MAX_STEPS = 8;

export function streamAgent({
  model,
  messages,
  system = SYSTEM_PROMPT,
  maxSteps = MAX_STEPS,
}: {
  model: LanguageModel;
  messages: ModelMessage[];
  system?: string;
  maxSteps?: number;
}) {
  return streamText({
    model,
    system,
    messages,
    stopWhen: stepCountIs(maxSteps),
  });
}
```

### The canvas

**`src/components/Canvas.tsx`** · new file · 19 lines

```tsx
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

// Excalidraw, and one line that matters: `excalidrawAPI` hands us the
// imperative handle. That handle — getSceneElements() and updateScene() — is
// the entire interface between the agent and the drawing. Everything the agent
// can see or change on this canvas goes through those two methods.
export default function Canvas({
  onApiReady,
}: {
  onApiReady: (api: ExcalidrawImperativeAPI) => void;
}) {
  return (
    <div className="canvas">
      <Excalidraw excalidrawAPI={onApiReady} />
    </div>
  );
}
```

`excalidrawAPI` is the whole interface between your agent and the drawing:
`getSceneElements()` to read, `updateScene()` to write. Everything in the rest of
this workshop goes through those two calls.

### The chat panel

**`src/components/Chat.tsx`** · new file · 91 lines

```tsx
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
```

### Wiring them together

**`src/App.tsx`** · new file · 31 lines

```tsx
// Part 1's App: canvas on the left, chat on the right, and a live agent — but
// the two halves do not know about each other yet.
//
// Type "draw a box" and it will tell you it cannot. That is the correct
// behaviour for Part 1 and it is worth seeing: the plumbing (Durable Object,
// websocket, streaming, message history) is already working, and the only
// thing missing is a tool.
import { useCallback, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "../../src/components/Canvas";
import Chat from "../../src/components/Chat";
import "../../src/App.css";

const sessionId = crypto.randomUUID();

export default function App() {
  const [, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const handleApi = useCallback((instance: ExcalidrawImperativeAPI) => setApi(instance), []);

  const agent = useAgent({ agent: "design-agent", name: sessionId });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  return (
    <div className="app">
      <Canvas onApiReady={handleApi} />
      <Chat messages={messages} sendMessage={sendMessage} status={status} />
    </div>
  );
}
```

### Check

```bash
npm run dev        # → http://localhost:5173
```

Type **"draw a box"**. It will tell you it cannot draw yet. Now open the network
tab and watch the websocket: the message went to a Durable Object, the reply
streamed back token by token, and if you refresh the page the conversation is
gone — because we deliberately generate a new session id per load, and the canvas
it referred to is gone too.