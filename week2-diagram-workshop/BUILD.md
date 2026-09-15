# Build the diagram agent — from an empty folder to a measured product

**Week 2 — evals and engineering discipline.**

Last week you built an agent and you know exactly how it works. This week you
build a different one — an agent that draws diagrams on a canvas you can watch —
and then you stop adding features and start measuring.

The reason we build a *drawing* agent for the week about evals is simple: you can
see when it is wrong. Nobody has to take the score on faith. The boxes overlap,
the arrow points at nothing, the label sits next to the shape instead of inside
it. First you see it, then you learn to measure it, then you fix it and watch the
number move.

Ten parts. Each one runs. Two of them add no features at all.

> ### How to read a listing
>
> Every code block is labelled with the file it belongs in, relative to your
> project root, and how much of the file it is:
>
> ```
> **`src/agent.ts`** · 86 lines                    ← the whole file
> **`src/tools/index.ts`** · lines 18–44 of the finished file   ← an excerpt
> ```
>
> Those labels are generated from the real files by `sync.mjs`, so the path and
> the line numbers cannot drift from the code. Line numbers always refer to the
> **finished** file in `app/` — your copy will be shorter until the last part,
> so use them to find the passage in the answer key, and use the **anchor** in
> each edit block ("find this line") to locate it in your own.
>
> Each part opens with a table of exactly which files it creates and which it
> changes.

> **The finished code lives in `app/`.** Use it as the answer key: every listing
> below is spliced out of that folder by `sync.mjs`, so nothing here is code that
> has never been executed. `steps/` holds the two earlier versions of files that
> change shape as the workshop goes on (the naive tool surface, the first
> prompt), so Parts 1–4 are runnable too and not just described.

---

## What you are building

```
   browser                                    Cloudflare Worker
   ┌──────────────────────────────┐           ┌───────────────────────────┐
   │ Excalidraw canvas            │           │ DesignAgent               │
   │   ▲            │             │  websocket│  (a Durable Object:       │
   │   │ draws      │ reads       │◄─────────►│   one per session, with   │
   │   │            ▼             │           │   its own message history)│
   │ App.tsx  onToolCall()        │           │        │                  │
   │   queryCanvas  addElements   │           │   agent-core.ts           │
   │   updateElements  remove…    │           │     streamText + tools    │
   └──────────────────────────────┘           │        │                  │
                                              │   searchWeb  searchKnow…  │
   node                                       └───────────────────────────┘
   ┌──────────────────────────────┐                     │
   │ evals/run.ts                 │                     ▼
   │   same prompt, same tools,   │                OpenAI · Tavily · vectors
   │   a simulated canvas         │
   └──────────────────────────────┘
```

Two ideas carry the whole week.

**1. The canvas lives in the browser, so the tools that touch it run in the
browser.** Four of the six tools have no `execute` on the server. The model calls
`addElements`, the call streams to the page, the page draws it and answers. That
is not a trick — it is the normal shape of an agent that manipulates something
the server cannot see.

**2. You never ship an improvement you have not measured.** From Part 3 onward
every change is followed by a number. Some of them jump. At least one of them
will not move at all, and that is the most useful result in the workshop.

---

## Part 0 — the folder

| file | |
|---|---|
| `package.json` | new — scripts and dependencies |
| `vite.config.ts` | new |
| `wrangler.jsonc` | new |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.worker.json`, `tsconfig.node.json` | new — copy all four from `app/` |
| `index.html` | new — copy from `app/` |
| `.dev.vars` | new — your keys, never committed |
| `.gitignore` | new — `node_modules`, `dist`, `.dev.vars`, `.wrangler` |

```bash
mkdir diagram-agent && cd diagram-agent
npm init -y
npm install @ai-sdk/openai @cloudflare/ai-chat @excalidraw/excalidraw agents ai react react-dom zod
npm install -D @cloudflare/vite-plugin @cloudflare/workers-types @types/node \
  @types/react @types/react-dom @vitejs/plugin-react braintrust dotenv-cli tsx typescript vite
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

---

## Part 2 — the first tool, and the agent draws

| file | |
|---|---|
| `src/tools.ts` | new |
| `src/system-prompt.ts` | new |
| `src/agent-core.ts` | **edit** — import the tools and the prompt, pass them to `streamText` |
| `src/App.tsx` | **replace** — the Part 1 version had no `onToolCall` |

**`src/tools.ts`** · new file · 65 lines

```ts
import { tool } from "ai";
import { z } from "zod";

// The Part 2 tool surface: one tool, elements described the obvious way.
//
// This is what almost everyone writes first, and there is nothing stupid about
// it — it mirrors how Excalidraw's own JSON looks. A shape is a shape, a label
// is a text element, an arrow has coordinates.
//
// Keep it. In Part 4 you will measure it, and in Part 5 you will replace it
// with the schema in src/tools/element-schema.ts and measure again. The gap
// between those two numbers is the argument for spending an afternoon on a
// tool schema instead of on a prompt.
const flatElement = z.object({
  id: z.string(),
  type: z.enum(["rectangle", "ellipse", "diamond", "arrow", "line", "text"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  // A caption is its own element here, floating at whatever coordinates the
  // model picked. Nothing ties it to the box it is meant to be inside.
  text: z.string().nullable(),
  strokeColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
});

export const generateDiagram = tool({
  description: `Draw a diagram on the canvas. Provide every element: shapes, arrows, and text labels.

Example: generateDiagram({ elements: [
  { type: "rectangle", id: "rect1", x: 100, y: 100, width: 200, height: 80, text: null, strokeColor: null, backgroundColor: null },
  { type: "text", id: "text1", x: 150, y: 130, width: 100, height: 25, text: "Start", strokeColor: null, backgroundColor: null },
  { type: "arrow", id: "arrow1", x: 300, y: 140, width: 100, height: 0, text: null, strokeColor: null, backgroundColor: null }
]})`,
  inputSchema: z.object({ elements: z.array(flatElement) }),
  strict: true,
});

export const modifyDiagram = tool({
  description: `Change elements that are already on the canvas. Pass the id and the fields to change.

Example: modifyDiagram({ updates: [{ id: "rect1", x: null, y: null, width: null, height: null, text: null, strokeColor: null, backgroundColor: "#fa5252" }] })`,
  inputSchema: z.object({
    updates: z.array(
      z.object({
        id: z.string(),
        x: z.number().nullable(),
        y: z.number().nullable(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        text: z.string().nullable(),
        strokeColor: z.string().nullable(),
        backgroundColor: z.string().nullable(),
      })
    ),
  }),
  strict: true,
});

// Part 2 has no queryCanvas: the agent cannot see the canvas at all yet. Part 5
// is where that changes, and the modify cases in the eval are what force it.
export function buildTools() {
  return { generateDiagram, modifyDiagram };
}
```

**`src/system-prompt.ts`** · new file · 14 lines

```ts
// Part 2's prompt: the tools are different, so the prompt has to be too.
export const SYSTEM_PROMPT = `You are a diagram design assistant. You help users create and modify diagrams on an Excalidraw canvas.

When the user asks for a diagram, call generateDiagram with the elements to draw.

Guidelines:
- Give each element a unique id
- Space elements at least 20px apart
- Rectangles for boxes, ellipses for states, diamonds for decisions
- Put a text element near or inside a shape to label it
- Connect related elements with arrows
- Lay diagrams out left to right or top to bottom

When the user asks to change something, call modifyDiagram with the element's id.`;
```

**Edit `src/agent-core.ts`.** Two changes. First, the imports at the top of the
file — find:

```ts
import { streamText, stepCountIs, type LanguageModel, type ModelMessage } from "ai";
```

and add below it:

```ts
import { buildTools } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";
```

Then delete the `SYSTEM_PROMPT` constant you wrote in Part 1 (it now lives in its
own file) and hand the tools to `streamText` — find the `return streamText({`
call and add one line:

```ts
  return streamText({
    model,
    system,
    messages,
    tools: buildTools(),        // ← add this
    stopWhen: stepCountIs(maxSteps),
  });
```

### The browser half

**`src/App.tsx`** · REPLACES the Part 1 version · 98 lines

```tsx
// Part 2's App: the first client-side tool.
//
// The agent now has generateDiagram and modifyDiagram, neither of which has an
// `execute` on the Worker. This handler is their implementation. The model's
// elements are dropped onto the canvas almost verbatim — flat shapes, free
// floating text, arrows with coordinates and no bindings.
//
// It works, and the diagrams look plausible. Part 4 measures how plausible.
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "../../src/components/Canvas";
import Chat from "../../src/components/Chat";
import "../../src/App.css";

const sessionId = crypto.randomUUID();

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const agent = useAgent({ agent: "design-agent", name: sessionId });

  const { messages, sendMessage, status } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      const scene = apiRef.current;
      const reply = (output: unknown) => addToolOutput({ toolCallId: toolCall.toolCallId, output });
      if (!scene) return reply({ error: "canvas not ready" });

      if (toolCall.toolName === "generateDiagram") {
        const { elements } = toolCall.input as { elements: Record<string, unknown>[] };
        // Excalidraw needs more fields than the model sends, so we fill in the
        // defaults by hand. Part 5 deletes all of this: the skeleton helper
        // does it properly, including the bindings we cannot do here.
        const drawn = elements.map((el) => ({
          ...el,
          strokeColor: el.strokeColor ?? "#1e1e1e",
          backgroundColor: el.backgroundColor ?? "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          angle: 0,
          seed: Math.floor(Math.random() * 100000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 100000),
          isDeleted: false,
          groupIds: [],
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
          ...(el.type === "arrow" || el.type === "line"
            ? { points: [[0, 0], [el.width ?? 0, el.height ?? 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow" }
            : {}),
          ...(el.type === "text"
            ? { fontSize: 20, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, originalText: el.text ?? "", lineHeight: 1.25 }
            : {}),
        }));

        const next = [...scene.getSceneElements(), ...(drawn as never[])];
        scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        scene.scrollToContent(next, { fitToContent: true });
        return reply({ added: drawn.length });
      }

      if (toolCall.toolName === "modifyDiagram") {
        const { updates } = toolCall.input as { updates: Record<string, unknown>[] };
        const next = scene.getSceneElements().map((el) => {
          const update = updates.find((u) => u.id === el.id);
          if (!update) return el;
          const fields: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(update)) if (k !== "id" && v !== null) fields[k] = v;
          return newElementWith(el, fields as never);
        });
        scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        return reply({ updated: updates.map((u) => u.id) });
      }

      return reply({ error: `unknown tool: ${toolCall.toolName}` });
    },
  });

  const handleApi = useCallback((instance: ExcalidrawImperativeAPI) => setApi(instance), []);

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
npm run dev
```

- *"draw a flow from User to API to Database"* — three boxes and two arrows.
- *"draw a flowchart for an order that may be out of stock"* — a diamond appears.

**It works.** Screenshot it, because this is the moment most tutorials end, and
the rest of this workshop is about what that screenshot is hiding.

Now try three things:

1. Drag one of the boxes. **The label stays behind.** It was never inside the
   box — it is a separate text element that happened to be drawn on top.
2. Drag it further. **The arrows stay behind too.** They were never attached to
   anything; they are lines at coordinates that happened to line up.
3. Type *"make the API box red"*. It cannot — it has no way to see what is on
   the canvas, so it either guesses an id or redraws everything.

Three real defects, none of which a screenshot shows. That is the argument for
Part 3.

> ### A fourth defect you cannot see yet
>
> `agent-core.ts` passes `stopWhen: stepCountIs(8)`, and it is natural to read
> that as "this agent can never loop". It is not.
>
> `stopWhen` bounds the steps inside **one** `streamText` call. That is a real
> bound while tools run on the server — the whole loop happens in one request.
> Your canvas tools run in the browser: the Worker streams a call out, the
> request ENDS, the browser answers, and that answer arrives as a **new**
> request with a **new** step counter starting at zero.
>
> Nothing accumulates. An agent that keeps calling tools keeps being granted a
> fresh budget, and it will happily do that until you close the tab. Part 8 is
> where it bites, and where we fix it properly.

---

## Part 3 — the eval harness

Nothing in this part changes how the agent behaves.

| file | |
|---|---|
| `src/agent-core.ts` | **edit** — add `runAgent` below `streamAgent` |
| `evals/types.ts` | new |
| `evals/datasets/golden.json` | new |
| `evals/scorers/schema.ts`, `structure.ts`, `tool-choice.ts` | new |
| `evals/run.ts` | new |
| `package.json` | **edit** — add the `eval:local` script |

### The problem: the agent needs a browser, and the eval has none

The four canvas tools are fulfilled by the page. Run the agent headlessly and
`queryCanvas` never returns, the loop hangs, and nothing is ever drawn to score.

So the eval brings its own canvas: an array. `runAgent` supplies the executors
that production leaves to the browser — push into the array, patch it, splice it,
read it back.

**Edit `src/agent-core.ts`:** add this function below `streamAgent`, and add
`generateText` and `tool` to the existing `import { … } from "ai"` line.

**`src/agent-core.ts`** · ADD below streamAgent · lines 100–220 of the finished file

```ts
/**
 * Headless run, for evals.
 *
 * The four canvas tools have no execute — in production the browser is their
 * implementation. Here we supply one: a plain array that stands in for the
 * scene. addElements pushes into it (after expanding labels and bindings the
 * way Excalidraw would), updateElements patches it, removeElements splices it,
 * queryCanvas reads it back.
 *
 * Without this the agent loop would hang on the first queryCanvas: a tool call
 * with no result and no browser to answer it.
 */
export async function runAgent({
  model,
  messages,
  system = SYSTEM_PROMPT,
  maxSteps = MAX_STEPS,
  env = {},
  seedCanvas = [],
  tools: toolsOverride,
}: AgentArgs & { seedCanvas?: unknown[] }) {
  const scene: Record<string, unknown>[] = (seedCanvas as Record<string, unknown>[]).map((el) => ({
    ...el,
  }));

  const base = buildTools(env);

  /**
   * Give a production tool an executor WITHOUT changing anything else about it.
   *
   * This spread is load-bearing. An earlier version of this file rebuilt each
   * tool by hand from `description` and `inputSchema`, which quietly dropped
   * `strict: true` — so the eval sent a schema production never sends, passed
   * with flying colours, and the live app died on its first request with
   * "'oneOf' is not permitted". The eval was measuring a sibling of the agent.
   *
   * Anything the tool declares, the eval must declare too. Only the execute
   * function is ours.
   */
  const withExecutor = <T>(definition: unknown, execute: (input: T) => Promise<unknown>) =>
    tool({ ...(definition as Record<string, unknown>), execute } as never);

  const tools = {
    queryCanvas: withExecutor(base.queryCanvas, async () => ({
      summary: serializeCanvasState(scene),
    })),
    addElements: withExecutor(base.addElements, async ({ elements }: { elements: unknown[] }) => {
      const existingIds = scene.map((el) => String(el.id));
      for (const el of applySkeleton(elements, existingIds)) {
        // An id that is already on the canvas replaces it rather than appending
        // a second copy — the same thing updateScene does in the browser.
        // Without this, a model that retries a call leaves two elements stacked
        // on the same spot and every overlap number lies.
        const at = scene.findIndex((existing) => existing.id === el.id);
        if (at >= 0) scene[at] = el;
        else scene.push(el);
      }
      // The same feedback the live app gives: what did this call collide with?
      return { added: elements.length, overlaps: findOverlaps(scene) };
    }),
    updateElements: withExecutor(
      base.updateElements,
      async ({ updates }: { updates: { id: string; fields: Record<string, unknown> }[] }) => {
        for (const { id, fields } of updates) {
          const target = scene.find((el) => el.id === id);
          if (!target) continue;
          for (const [key, value] of Object.entries(fields)) {
            if (value === null) continue; // null means "leave it alone"
            // A label lives in a child text element, not on the shape.
            if (key === "text") {
              const label = scene.find((el) => el.containerId === id);
              if (label) label.text = value;
              else target.text = value;
              continue;
            }
            target[key] = value;
          }
        }
        return { updated: updates.map((u) => u.id), overlaps: findOverlaps(scene) };
      }
    ),
    removeElements: withExecutor(base.removeElements, async ({ ids }: { ids: string[] }) => {
        for (const id of ids) {
          const at = scene.findIndex((el) => el.id === id);
          if (at >= 0) scene.splice(at, 1);
          // Its label goes with it.
          for (let i = scene.length - 1; i >= 0; i--) {
            if (scene[i]!.containerId === id) scene.splice(i, 1);
          }
        }
      return { removed: ids };
    }),
    // Present only when configured — see buildTools.
    ...(base.searchWeb ? { searchWeb: base.searchWeb } : {}),
    ...(base.searchKnowledge ? { searchKnowledge: base.searchKnowledge } : {}),
  };

  const missing = describeMissing(tools as Record<string, unknown>);

  const result = await generateText({
    model,
    // Same errata as the live agent: the eval must see the deployment the
    // agent sees, tools and prompt alike.
    system: missing ? `${system}\n\n${missing}` : system,
    messages,
    // An overridden surface gets the same simulated canvas treatment: whatever
    // its tools are called, their output still has to land in `scene` or the
    // scorers would have nothing to read.
    tools: (toolsOverride ? wrapLegacyTools(toolsOverride, scene) : tools) as never,
    stopWhen: stepCountIs(maxSteps) as never,
  });

  // Flat list of tool names in call order. Several scorers care less about the
  // drawing than about whether the agent reached for the right tool at all.
  const toolCalls: string[] = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls ?? []) toolCalls.push(call.toolName);
  }

  return { text: result.text, elements: scene, toolCalls, steps: result.steps };
}
```

> **The rule this file exists to enforce:** the eval must not build its own
> prompt or its own tool set. The moment it does, it is measuring a sibling of
> your agent and every number it gives you is a guess about something you do not
> ship. Same `SYSTEM_PROMPT`, same `buildTools`, same step limit.

> ### This workshop broke that rule, and here is what it cost
>
> An earlier version of `runAgent` rebuilt each tool by hand:
>
> ```ts
> addElements: tool({
>   description: base.addElements.description,   // ← copied
>   inputSchema: base.addElements.inputSchema,   // ← copied
>   execute: async ({ elements }) => { … },      // ← ours
> })
> ```
>
> Reasonable-looking, and wrong. The production tool also declares
> `strict: true`, and that line was not copied. So the eval sent a *non-strict*
> schema, OpenAI accepted it, and the suite reported 98%.
>
> The live app then died on its very first request:
>
> ```
> Invalid schema for function 'addElements':
> In context=('properties','elements','items'), 'oneOf' is not permitted.
> ```
>
> A 400 on every single message, from an agent whose eval suite said it was
> nearly perfect. That is not a near miss — it is the exact failure the rule
> exists to prevent, committed by the person writing the rule.
>
> The fix is to spread the definition instead of re-typing the interesting parts
> of it, so that anything the tool declares, the eval declares too:
>
> ```ts
> const withExecutor = (definition, execute) => tool({ ...definition, execute });
> ```
>
> Test your harness the way you test your agent: put a bug into production code
> on purpose and check the suite goes red. If it stays green, it is decoration.

### The dataset

Fourteen cases, four categories: `create`, `modify`, `domain`, `edge`.

**`evals/types.ts`** · new file · 45 lines

```ts
// The shape of one test case, and of one scorer.
//
// Both runners — the local one and the Braintrust one — use these, so a scorer
// is written once and can be run with or without an account.

export type Category = "create" | "modify" | "domain" | "edge";
export type Difficulty = "simple" | "medium" | "hard";

export interface GoldenCase {
  id: string;
  /** What the user types. */
  input: string;
  category: Category;
  difficulty: Difficulty;
  /** Elements already on the canvas when the turn starts. Modify cases only. */
  seed?: unknown[];
  /** Plain-English facts about a good answer. Read by the judge scorer. */
  expect: string[];
  /** Counts a correct diagram must contain, e.g. { rectangle: 3, arrow: 2 }. */
  expectCounts?: Record<string, number>;
  /** Words that must appear in the labels, lowercased. */
  expectLabels?: string[];
  /** Ids that must still exist afterwards. Modify cases only. */
  preserveIds?: string[];
  /** True when the right answer is to draw nothing at all. */
  expectNoDraw?: boolean;
}

export interface AgentOutput {
  text: string;
  elements: unknown[];
  toolCalls: string[];
}

export interface Score {
  name: string;
  /** 0 to 1. null means "not applicable to this case" — the runner skips it. */
  score: number | null;
  note?: string;
}

export type Scorer = (args: {
  case: GoldenCase;
  output: AgentOutput;
}) => Score | Promise<Score>;
```

A case looks like this — a `create` one, then a `modify` one that starts with
elements already on the canvas:

**`evals/datasets/golden.json`** · 2 of the 14 cases — copy the whole file from app/ · lines 18–37 of the finished file

```json
  {
    "id": "create-02-three-chain",
    "input": "Draw a flow from User to API to Database",
    "category": "create",
    "difficulty": "simple",
    "expectCounts": {
      "rectangle": 3,
      "arrow": 2
    },
    "expectLabels": [
      "user",
      "api",
      "database"
    ],
    "expect": [
      "Three labelled boxes: User, API and Database",
      "An arrow runs from User to API and another from API to Database",
      "The three boxes do not overlap each other"
    ]
  },
```

Three things to notice about the dataset, because they are what makes it useful
rather than decorative:

- **The modify cases carry a `seed`.** The canvas is not empty when the turn
  starts, which is the only way to test "change the thing that is already there".
- **`expectCounts` and `expectLabels` are checkable by code.** Anything a
  computer can check, a computer should check.
- **There is a case where the right answer is to draw nothing** (`edge-02`).
  Every eval suite drifts towards rewarding action. Keep a case that punishes it.

### The first three scorers

**`evals/scorers/schema.ts`** · new file · 29 lines

```ts
import type { Scorer } from "../types";

// Does the output even qualify as a diagram?
//
// The bluntest scorer, and the one you write first: no elements at all, or
// elements missing the fields the canvas needs, means everything downstream is
// noise. Binary on purpose — half a valid element is not half a diagram.
const REQUIRED = ["id", "type", "x", "y", "width", "height"] as const;
const TYPES = ["rectangle", "ellipse", "diamond", "arrow", "line", "text"];

export const schema: Scorer = ({ case: testCase, output }) => {
  // A case whose correct answer is an empty canvas must not be marked down for
  // producing one. A scorer that punishes the right answer is worse than no
  // scorer: it teaches you to "fix" an agent that was already correct.
  if (testCase.expectNoDraw) return { name: "schema", score: null };

  if (!Array.isArray(output.elements) || output.elements.length === 0) {
    return { name: "schema", score: 0, note: "no elements produced" };
  }
  for (const el of output.elements as Record<string, unknown>[]) {
    for (const field of REQUIRED) {
      if (!(field in el)) return { name: "schema", score: 0, note: `${el.id} missing ${field}` };
    }
    if (typeof el.type !== "string" || !TYPES.includes(el.type)) {
      return { name: "schema", score: 0, note: `bad type: ${String(el.type)}` };
    }
  }
  return { name: "schema", score: 1, note: `${output.elements.length} elements` };
};
```

**`evals/scorers/structure.ts`** · new file · 32 lines

```ts
import type { Scorer } from "../types";

// Did it draw the right NUMBER of the right THINGS?
//
// "Draw three boxes connected by arrows" has a checkable answer: three
// rectangles, two arrows. The case declares that in `expectCounts` and this
// scorer compares. Partial credit, because two boxes out of three is genuinely
// better than zero and you want to see that difference when you tune.
//
// Note what it deliberately cannot see: whether the diagram makes sense. That
// is the judge's job. This one is arithmetic, and arithmetic is free.
export const structure: Scorer = ({ case: testCase, output }) => {
  const expected = testCase.expectCounts;
  if (!expected) return { name: "structure", score: null };

  const counts: Record<string, number> = {};
  for (const el of output.elements as { type?: string; containerId?: string }[]) {
    // A bound label is part of its shape, not an element in its own right.
    if (el.containerId) continue;
    if (el.type) counts[el.type] = (counts[el.type] ?? 0) + 1;
  }

  let earned = 0;
  const parts: string[] = [];
  for (const [type, want] of Object.entries(expected)) {
    const got = counts[type] ?? 0;
    earned += Math.min(got, want) / want;
    parts.push(`${type} ${got}/${want}`);
  }
  const score = earned / Object.keys(expected).length;
  return { name: "structure", score, note: parts.join(", ") };
};
```

**`evals/scorers/tool-choice.ts`** · new file · 45 lines

```ts
import type { Scorer } from "../types";

// Did it reach for the right tool, in the right order?
//
// This scorer never looks at the drawing. It looks at the sequence of tool
// names, which turns out to be where a lot of agent quality lives:
//
//   create → addElements must have been called. A chatty reply describing the
//            diagram it would draw is a failure, however well written.
//   modify → queryCanvas must come BEFORE the first mutation. An agent that
//            edits ids it guessed will be right often enough to fool a demo
//            and wrong often enough to lose someone's work.
//
// Partial credit for mutating without looking: the intent was right, the
// discipline was not.
// Tool names change as the design does. Part 2 draws with generateDiagram;
// from Part 5 on it is addElements. The scorer has to recognise both, or every
// comparison between the two designs measures the rename instead of the work.
const DRAW = ["addElements", "generateDiagram"];
const MUTATE = ["addElements", "updateElements", "removeElements", "generateDiagram", "modifyDiagram"];

export const toolChoice: Scorer = ({ case: testCase, output }) => {
  const calls = output.toolCalls ?? [];

  if (testCase.category === "create" || testCase.category === "domain") {
    const ok = calls.some((c) => DRAW.includes(c));
    return { name: "toolChoice", score: ok ? 1 : 0, note: ok ? "drew something" : `never called addElements (${calls.join(" → ") || "no tools"})` };
  }

  if (testCase.category === "modify") {
    const firstMutation = calls.findIndex((c) => MUTATE.includes(c));
    const queried = calls.indexOf("queryCanvas");
    if (firstMutation < 0) return { name: "toolChoice", score: 0, note: "nothing was changed" };
    if (queried < 0 || queried > firstMutation) {
      // Half marks, and the half that is missing is real: an agent editing ids
      // it never looked up is guessing. On the Part 2 tool surface it cannot
      // do better — there is no queryCanvas — which is precisely the argument
      // for adding one.
      return { name: "toolChoice", score: 0.5, note: "changed the canvas without reading it first" };
    }
    return { name: "toolChoice", score: 1, note: calls.join(" → ") };
  }

  return { name: "toolChoice", score: null };
};
```

### The runner

**`evals/run.ts`** · new file — you will add scorers to it in Part 4 · 152 lines

```ts
// The local eval runner. No account, no dashboard, no network beyond the model
// call itself — just the dataset, the scorers, and a table.
//
// Run it:
//   npm run eval:local                 the whole suite
//   npm run eval:local -- --case modify    only cases whose id contains "modify"
//   npm run eval:local -- --no-judge       skip the LLM judge (free and instant)
//
// Braintrust (evals/diagram.eval.ts) does more: it stores every run, diffs
// experiments, and shows you which case regressed. Use it for the improvement
// loop. Use this one while you are writing scorers, because a scorer you are
// still debugging should not cost a round trip to anyone's servers.
import { readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { runAgent } from "../src/agent-core";
import type { AgentOutput, GoldenCase, Score, Scorer } from "./types";
import { schema } from "./scorers/schema";
import { structure } from "./scorers/structure";
import { boundArrows } from "./scorers/bound-arrows";
import { boundLabels } from "./scorers/bound-labels";
import { noOverlaps } from "./scorers/no-overlaps";
import { toolChoice } from "./scorers/tool-choice";
import { labels } from "./scorers/labels";
import { preserved } from "./scorers/preserved";
import { restraint } from "./scorers/restraint";
import { makeJudge } from "./scorers/judge";

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const useJudge = !args.includes("--no-judge");

// Run the suite against a different system prompt without editing the agent:
//   EVAL_SYSTEM_FILE=steps/part3/system-prompt.ts npm run eval:local
// That is how Part 6 compares the prompt it just wrote against the one it
// replaced, on the same dataset, in the same run conditions.
const systemFile = process.env.EVAL_SYSTEM_FILE;
const system = systemFile
  ? ((await import(`${process.cwd()}/${systemFile}`)) as { SYSTEM_PROMPT: string }).SYSTEM_PROMPT
  : undefined;

// Same idea for the tool surface:
//   EVAL_TOOLS_FILE=steps/part2/tools.ts npm run eval:local
const toolsFile = process.env.EVAL_TOOLS_FILE;
const tools = toolsFile
  ? ((await import(`${process.cwd()}/${toolsFile}`)) as { buildTools: () => Record<string, unknown> }).buildTools()
  : undefined;

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set — put it in .dev.vars");

const openai = createOpenAI({ apiKey });
// A small model for the agent under test. Evals are meant to be run often; if
// a full pass costs a dollar you will stop running it, and an eval you do not
// run is worth nothing.
const model = openai.chat(process.env.EVAL_MODEL ?? "gpt-5.4-mini");

const cases: GoldenCase[] = JSON.parse(readFileSync("evals/datasets/golden.json", "utf8"));
const selected = only ? cases.filter((c) => c.id.includes(only)) : cases;

const scorers: Scorer[] = [
  schema,
  structure,
  toolChoice,
  boundArrows,
  boundLabels,
  noOverlaps,
  labels,
  preserved,
  restraint,
  ...(useJudge ? [makeJudge(apiKey)] : []),
];

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);

const totals = new Map<string, { sum: number; n: number }>();
const rows: { id: string; scores: Score[]; ms: number }[] = [];

for (const testCase of selected) {
  const started = Date.now();
  let output: AgentOutput;
  try {
    const result = await runAgent({
      model,
      system,
      tools,
      messages: [{ role: "user", content: testCase.input }],
      seedCanvas: testCase.seed ?? [],
      env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY,
             UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL,
             UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN },
    });
    output = { text: result.text, elements: result.elements, toolCalls: result.toolCalls };
  } catch (err) {
    // A crashed run is a zero, not a crashed suite. You want the other
    // nineteen numbers even when one case blows up.
    console.log(`  ✘ ${testCase.id} — agent threw: ${(err as Error).message}`);
    output = { text: "", elements: [], toolCalls: [] };
  }

  const scores: Score[] = [];
  for (const scorer of scorers) {
    const score = await scorer({ case: testCase, output });
    scores.push(score);
    if (score.score === null) continue;
    const t = totals.get(score.name) ?? { sum: 0, n: 0 };
    t.sum += score.score;
    t.n += 1;
    totals.set(score.name, t);
  }

  rows.push({ id: testCase.id, scores, ms: Date.now() - started });

  const summary = scores
    .filter((s) => s.score !== null)
    .map((s) => `${s.name} ${pct(s.score!)}`)
    .join("  ");
  console.log(`  ${pad(testCase.id, 26)} ${summary}`);
  for (const s of scores) {
    if (s.score !== null && s.score < 1 && s.note) console.log(`      ${pad(s.name, 12)} ${s.note}`);
  }
}

console.log("\n  ── averages ──");
let overall = 0;
for (const [name, { sum, n }] of [...totals].sort()) {
  console.log(`  ${pad(name, 14)} ${pct(sum / n)}   (${n} case${n === 1 ? "" : "s"})`);
  overall += sum / n;
}
const mean = overall / totals.size;
console.log(`\n  overall ${pct(mean)} across ${rows.length} cases\n`);

// Write the run to disk so you can diff two runs by hand. Braintrust does this
// properly; this is the version you can read in a text editor.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  `evals/results/${stamp}.json`,
  JSON.stringify(
    {
      model: process.env.EVAL_MODEL ?? "gpt-5.4-mini",
      system: systemFile ?? "src/system-prompt.ts",
      tools: toolsFile ?? "src/tools/index.ts",
      mean,
      rows,
    },
    null,
    2
  )
);
console.log(`  saved evals/results/${stamp}.json\n`);
```

### Check — your first number

```bash
npm run eval:local
```

Against the Part 2 agent, on `gpt-5.4-mini`, that is roughly:

```
  schema        100%
  structure      93%
  toolChoice     79%
  overall        91%
```

And that number is a **lie**. Not a bug — a lie of omission. Every scorer you
have says the agent is nearly perfect, because every scorer you have measures
something the agent is genuinely good at: it produces well-formed elements of
roughly the right kinds, and it calls a drawing tool when asked to draw.

None of them can see the three defects you found by dragging a box.

**This is the most important thing in the week.** A high score from a thin suite
is worse than no score, because it will stop you looking.

---

## Part 4 — scorers that can see the real failures

Still nothing that changes how the agent behaves. Each scorer here exists
because of a specific failure you can point at on screen.

| file | |
|---|---|
| `src/canvas/overlaps.ts` | new |
| `src/canvas/serialize.ts` | new — the judge needs it |
| `evals/scorers/bound-arrows.ts`, `bound-labels.ts`, `no-overlaps.ts` | new |
| `evals/scorers/labels.ts`, `preserved.ts`, `restraint.ts` | new |
| `evals/scorers/judge.ts` | new |
| `evals/run.ts` | **edit** — import and list the seven new scorers |

**`evals/scorers/bound-arrows.ts`** · new file · 21 lines

```ts
import type { Scorer } from "../types";

// Are the arrows actually attached to anything?
//
// This is the scorer that catches the prettiest kind of broken diagram. The
// model emits arrows with plausible coordinates that LOOK like connections in
// a screenshot, but have no binding — so the moment anyone drags a box, the
// arrows stay behind and the diagram falls apart in their hands.
//
// Fraction of arrows with both ends bound.
export const boundArrows: Scorer = ({ output }) => {
  const arrows = (output.elements as Record<string, unknown>[]).filter((el) => el.type === "arrow");
  if (arrows.length === 0) return { name: "boundArrows", score: null };

  const bound = arrows.filter((a) => a.startBinding && a.endBinding).length;
  return {
    name: "boundArrows",
    score: bound / arrows.length,
    note: `${bound}/${arrows.length} arrows bound at both ends`,
  };
};
```

**`evals/scorers/bound-labels.ts`** · new file · 46 lines

```ts
import type { Scorer } from "../types";

// Is the text inside the boxes, or merely on top of them?
//
// Excalidraw binds a shape's label to the shape via containerId. A model that
// ignores the `label` field and drops a free-floating text element at the same
// coordinates produces something that looks right in a screenshot and comes
// apart the moment the box moves — the same class of failure as an unbound
// arrow, and just as invisible until someone interacts with it.
//
// Scores the fraction of text elements that are properly bound. Floating
// annotations that sit clear of every shape are fine and are not counted.
interface El {
  type?: string;
  containerId?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const inside = (text: El, shape: El) =>
  (text.x ?? 0) >= (shape.x ?? 0) &&
  (text.y ?? 0) >= (shape.y ?? 0) &&
  (text.x ?? 0) <= (shape.x ?? 0) + (shape.width ?? 0) &&
  (text.y ?? 0) <= (shape.y ?? 0) + (shape.height ?? 0);

export const boundLabels: Scorer = ({ output }) => {
  const els = output.elements as El[];
  const texts = els.filter((el) => el.type === "text");
  if (texts.length === 0) return { name: "boundLabels", score: null };

  const shapes = els.filter((el) => ["rectangle", "ellipse", "diamond"].includes(el.type ?? ""));
  let ok = 0;
  let floatingOnShape = 0;
  for (const text of texts) {
    if (text.containerId) ok++;
    else if (shapes.some((shape) => inside(text, shape))) floatingOnShape++;
    else ok++; // a genuine annotation, sitting on its own
  }
  return {
    name: "boundLabels",
    score: ok / texts.length,
    note: floatingOnShape ? `${floatingOnShape} floating text on top of a shape` : "all labels bound",
  };
};
```

**`src/canvas/overlaps.ts`** · new file · 64 lines

```ts
// Overlap detection: the cheapest quality signal in the whole project.
//
// Models are bad at coordinates. Not a little bad — reliably bad, in a
// specific way: they produce plausible-looking numbers that put two boxes on
// top of each other, and then describe the result as a clean diagram, because
// they cannot see it.
//
// You can attack that with a better prompt (Part 6 does: a layout grid with
// fixed strides), and you should. But the prompt is advice given before the
// fact. This is evidence returned after it. We compute which boxes collide and
// hand that back IN THE TOOL RESULT — so the model reads "rect_api overlaps
// rect_db" the way it reads any other tool output, and moves them apart on its
// next call.
//
// Two lessons hide in this file:
//   - A tool result is not just data, it is feedback. The model can act on
//     what you put there. Most tools return `{ ok: true }` and waste the slot.
//   - The same function scores the eval (`noOverlaps`) and steers the agent at
//     run time. One definition of "good", used in both places, cannot drift.

interface Box {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  containerId?: string | null;
}

// Arrows are allowed to cross things — that is their job. Labels live inside
// their container by definition. Neither counts as an overlap.
const counts = (el: Box) =>
  !el.isDeleted &&
  !el.containerId &&
  el.type !== "arrow" &&
  el.type !== "line" &&
  (el.width ?? 0) > 0 &&
  (el.height ?? 0) > 0;

/** Pairs of element ids whose bounding boxes intersect. */
export function findOverlaps(elements: unknown[]): [string, string][] {
  const boxes = (elements as Box[]).filter(counts);
  const hits: [string, string][] = [];

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ax2 = (a.x ?? 0) + (a.width ?? 0);
      const ay2 = (a.y ?? 0) + (a.height ?? 0);
      const bx2 = (b.x ?? 0) + (b.width ?? 0);
      const by2 = (b.y ?? 0) + (b.height ?? 0);

      // Touching edges is fine; only a real intersection counts.
      const separated =
        ax2 <= (b.x ?? 0) || bx2 <= (a.x ?? 0) || ay2 <= (b.y ?? 0) || by2 <= (a.y ?? 0);

      if (!separated) hits.push([a.id, b.id]);
    }
  }
  return hits;
}
```

**`evals/scorers/no-overlaps.ts`** · new file · 27 lines

```ts
import { findOverlaps } from "../../src/canvas/overlaps";
import type { Scorer } from "../types";

// Is the layout readable?
//
// The same findOverlaps the agent gets in its tool results — which is the
// point. One definition of "clean layout" steers the agent at run time and
// grades it at eval time, so the thing you optimise and the thing you measure
// cannot drift apart.
//
// Graded rather than binary: one collision in a twelve-box architecture
// diagram is a blemish, and six is a pile. A binary score hides the difference
// and makes the improvement loop feel flat when it is actually working.
export const noOverlaps: Scorer = ({ output }) => {
  const shapes = (output.elements as { type?: string; containerId?: string | null }[]).filter(
    (el) => !el.containerId && el.type !== "arrow" && el.type !== "line"
  );
  const pairs = (shapes.length * (shapes.length - 1)) / 2;
  if (pairs === 0) return { name: "noOverlaps", score: null };

  const hits = findOverlaps(output.elements);
  return {
    name: "noOverlaps",
    score: Math.max(0, 1 - hits.length / pairs),
    note: hits.length ? `${hits.length} overlapping pair(s): ${hits.slice(0, 3).map((p) => p.join("+")).join(", ")}` : "clean",
  };
};
```

Three more, each short enough to read in one breath. `labels.ts` checks the nouns
from the request made it onto the canvas:

**`evals/scorers/labels.ts`** · new file · 25 lines

```ts
import type { Scorer } from "../types";

// Does the diagram say the words the user asked for?
//
// Cheap, literal, and surprisingly effective: if someone asks for a login flow
// with a User, an Auth Server and a Database, those three words should appear
// on the canvas. It cannot tell you the diagram is *good* — but a diagram
// missing the nouns from the request is definitely wrong, and this catches it
// for free.
export const labels: Scorer = ({ case: testCase, output }) => {
  const wanted = testCase.expectLabels;
  if (!wanted?.length) return { name: "labels", score: null };

  const text = (output.elements as { text?: string; label?: { text?: string } }[])
    .map((el) => `${el.text ?? ""} ${el.label?.text ?? ""}`)
    .join(" ")
    .toLowerCase();

  const found = wanted.filter((word) => text.includes(word.toLowerCase()));
  return {
    name: "labels",
    score: found.length / wanted.length,
    note: found.length === wanted.length ? "all present" : `missing: ${wanted.filter((w) => !found.includes(w)).join(", ")}`,
  };
};
```

`preserved.ts` checks a modify turn did not destroy what it was not asked to
touch:

**`evals/scorers/preserved.ts`** · new file · 20 lines

```ts
import type { Scorer } from "../types";

// Did it leave alone what it was not asked to touch?
//
// The failure this catches is the most annoying one a user can experience:
// they ask for one box to be recoloured and the agent helpfully redraws the
// whole diagram, throwing away every manual tweak they had made. The canvas
// looks fine in a screenshot. The person is furious.
export const preserved: Scorer = ({ case: testCase, output }) => {
  const ids = testCase.preserveIds;
  if (!ids?.length) return { name: "preserved", score: null };

  const present = new Set((output.elements as { id?: string }[]).map((el) => el.id));
  const kept = ids.filter((id) => present.has(id));
  return {
    name: "preserved",
    score: kept.length / ids.length,
    note: kept.length === ids.length ? "nothing lost" : `lost: ${ids.filter((id) => !present.has(id)).join(", ")}`,
  };
};
```

And `restraint.ts` checks the agent kept its hands still on the one case where
drawing is the wrong answer:

**`evals/scorers/restraint.ts`** · new file · 23 lines

```ts
import type { Scorer } from "../types";

// The negative case: sometimes the correct number of tool calls is zero.
//
// Every eval suite drifts towards rewarding action, because action is what you
// can see. Then you ship an agent that redraws the canvas when someone types
// "thanks". Keep at least one case where doing nothing is the right answer, or
// you are only measuring half the behaviour.
export const restraint: Scorer = ({ case: testCase, output }) => {
  if (!testCase.expectNoDraw) return { name: "restraint", score: null };

  const drew = (output.toolCalls ?? []).some((call) =>
    ["addElements", "updateElements", "removeElements"].includes(call)
  );
  const answered = output.text.trim().length > 0;

  if (drew) return { name: "restraint", score: 0, note: "changed the canvas when it should have replied" };
  return {
    name: "restraint",
    score: answered ? 1 : 0.5,
    note: answered ? "replied without drawing" : "drew nothing, said nothing",
  };
};
```

Two of those needed a way to describe the canvas in words. So does the judge
below, so write it now — Part 6 is where we argue about why it looks like this.

**`src/canvas/serialize.ts`** · new file · 82 lines

```ts
// Turning a canvas into something a model can read.
//
// An Excalidraw scene is an array of elements with about thirty fields each,
// plus the bookkeeping that makes undo and collaboration work. Sending that
// JSON to the model is possible and wasteful: a six-box diagram is roughly
// 4,000 tokens of mostly `versionNonce`.
//
// So we write a serialiser. One line per element, only the fields the model
// can act on: id, type, where it is, how big it is, what it says, and what an
// arrow connects. A six-box diagram becomes about 120 tokens.
//
// The subtle part is labels. When Excalidraw renders a labelled box it stores
// TWO elements: the rectangle, and a text element whose `containerId` points
// back at it. Read the scene naively and you will report six boxes and six
// mysterious text elements, and the model will start "fixing" the duplicates.
// So we fold each label into its container and never mention it again.

interface SceneElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  backgroundColor?: string;
  strokeColor?: string;
  containerId?: string | null;
  isDeleted?: boolean;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}

const round = (n: number | undefined) => Math.round(n ?? 0);

export function serializeCanvasState(elements: unknown[]): string {
  const scene = (elements as SceneElement[]).filter((el) => el && !el.isDeleted);
  if (scene.length === 0) return "The canvas is empty.";

  // Pass one: collect every text element that belongs to a container.
  const labels = new Map<string, string>();
  for (const el of scene) {
    if (el.type === "text" && el.containerId && el.text) {
      labels.set(el.containerId, el.text);
    }
  }

  // Pass two: one line per real element. Bound labels are skipped — they were
  // folded into their container above.
  const lines: string[] = [];
  for (const el of scene) {
    if (el.type === "text" && el.containerId) continue;

    const label = labels.get(el.id) ?? (el.type === "text" ? el.text : undefined);
    const where = `(${round(el.x)}, ${round(el.y)}) ${round(el.width)}x${round(el.height)}`;

    if (el.type === "arrow" || el.type === "line") {
      const from = el.startBinding?.elementId ?? "unbound";
      const to = el.endBinding?.elementId ?? "unbound";
      lines.push(
        `${el.id} — ${el.type} ${from} → ${to}${label ? ` labelled "${label}"` : ""}`
      );
      continue;
    }

    // Colour is included only when it is set to something. It matters more
    // than it looks: "make the login box red" is a common request, and a
    // summary that omits colour leaves both the agent and the eval judge
    // unable to tell whether it worked.
    const fill =
      el.backgroundColor && el.backgroundColor !== "transparent"
        ? `, filled ${el.backgroundColor}`
        : "";
    const stroke = el.strokeColor && el.strokeColor !== "#1e1e1e" ? `, stroke ${el.strokeColor}` : "";

    lines.push(
      `${el.id} — ${el.type} at ${where}${label ? ` labelled "${label}"` : ""}${fill}${stroke}`
    );
  }

  return `${lines.length} element${lines.length === 1 ? "" : "s"} on the canvas:\n${lines.join("\n")}`;
}
```

### And one that is not deterministic

**`evals/scorers/judge.ts`** · new file · 74 lines

```ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { serializeCanvasState } from "../../src/canvas/serialize";
import type { Scorer } from "../types";

// The one scorer that costs money, and the only one that can read meaning.
//
// Everything else in this folder is arithmetic: count the rectangles, check
// the bindings, measure the boxes. That covers most of what "broken" means for
// a diagram — and then it runs out. "Does this actually depict an OAuth
// authorization code flow?" is not a property you can compute.
//
// So: a model reads the canvas and checks the claims in `expect`. Three rules
// keep it honest, and they generalise to every LLM judge you will ever write:
//
//   1. Ask for a verdict per claim, never a vibe. "Score this diagram out of
//      ten" produces a number that means nothing and drifts between runs.
//   2. Make each claim binary. Yes or no, with the evidence quoted from the
//      canvas summary it was given.
//   3. Judge the artifact, not the agent's story about the artifact. We pass
//      the serialised canvas — the same summary the agent itself would read —
//      and not the chat reply, which is where a model will tell you it drew
//      something beautiful.
//
// Reach for this LAST. A deterministic scorer is free, instant, and identical
// every run; a judge is none of those. Use it only for what code cannot see.
const verdicts = z.object({
  results: z.array(
    z.object({
      claim: z.string(),
      holds: z.boolean(),
      evidence: z.string().describe("Quote the element ids or labels that decide it"),
    })
  ),
});

export function makeJudge(apiKey: string | undefined, model = "gpt-5.4-mini"): Scorer {
  return async ({ case: testCase, output }) => {
    if (!testCase.expect?.length) return { name: "judge", score: null };
    if (!apiKey) return { name: "judge", score: null, note: "no OPENAI_API_KEY" };

    const openai = createOpenAI({ apiKey });
    const canvas = serializeCanvasState(output.elements);

    const { object } = await generateObject({
      model: openai.chat(model),
      schema: verdicts,
      system:
        "You check whether a diagram satisfies a list of claims. You see a text " +
        "summary of the canvas: every element with its id, type, position, size and " +
        "label. Judge ONLY from that summary. For each claim answer true or false and " +
        "quote the ids or labels that decide it. Do not be generous: a claim that is " +
        "partly satisfied is false.",
      prompt: [
        `The user asked: ${testCase.input}`,
        "",
        "Canvas:",
        canvas,
        "",
        "Claims to check:",
        ...testCase.expect.map((claim, i) => `${i + 1}. ${claim}`),
      ].join("\n"),
    });

    const held = object.results.filter((r) => r.holds);
    const failed = object.results.filter((r) => !r.holds);
    return {
      name: "judge",
      score: object.results.length ? held.length / object.results.length : null,
      note: failed.length ? `failed: ${failed.map((f) => f.claim).join("; ")}` : "all claims hold",
    };
  };
}
```

> **When to reach for a judge.** Last. A deterministic scorer is free, instant,
> and gives the same answer every run; a judge costs a call, adds latency, and
> has opinions. Use one only for what code cannot see — "is this actually a
> sequence diagram?" — and constrain it hard: one verdict per claim, binary,
> with the evidence quoted. Never "rate this out of ten".
>
> Note what the judge is given: the serialised canvas, not the agent's reply.
> Ask a model to grade another model's description of its own work and it will
> grade the description.

### Check — the number stops lying

```bash
npm run eval:local
```

```
  boundArrows     17%     ← arrows are not attached to anything
  boundLabels     37%     ← most labels are floating text on top of a shape
  noOverlaps      75%
  labels          90%
  preserved      100%
  restraint      100%
  schema         100%
  structure       93%
  toolChoice      79%     ← no way to look at the canvas before editing it
  judge           57%
  overall         75%
```

**75%.** Same agent as ten minutes ago, when it scored 91%. Nothing got worse;
you just stopped grading it on the parts it was already good at.

Write that number down. It is the baseline, and every part from here is judged
against it.

---

## Part 5 — fix it in the schema, not the prompt

| file | |
|---|---|
| `src/tools/element-schema.ts` | new |
| `src/tools/add-elements.ts`, `update-elements.ts`, `remove-elements.ts`, `query-canvas.ts` | new |
| `src/tools/index.ts` | new — replaces the flat `src/tools.ts` from Part 2, which you can delete |
| `src/canvas/bindings.ts` | new |
| `src/canvas/skeleton.ts` | new |
| `src/App.tsx` | **replace** — real handlers for all four client tools |
| `src/agent-core.ts` | **edit** — import `buildTools` from `./tools` and `applySkeleton` |

The obvious response to "the labels are not attached" is to write a better
prompt: *"remember to bind labels to shapes!"* Try it if you like — you will get
a small, unreliable improvement, because you are asking the model to remember
something on every single call.

The better move is to make the broken thing **unrepresentable**. The model cannot
produce a floating label if the only way to write a label is a field on the
shape. It cannot produce a floating arrow if arrows take shape ids rather than
coordinates.

**`src/tools/element-schema.ts`** · new file · 111 lines

```ts
// The shape of one diagram element, as the model is allowed to produce it.
//
// This file is the highest-leverage file in the project, and it is worth
// understanding why before reading the code.
//
// Excalidraw's real element type has ~30 fields per element: version, seed,
// versionNonce, updated, frameId, boundElements, and so on. A model asked to
// emit all of that will get some of it wrong on every call. So we do not ask.
// We define the SMALL subset that describes a diagram — type, position, size,
// a label, and for arrows which shapes they connect — and let Excalidraw's own
// `convertToExcalidrawElements` helper fill in everything else.
//
// Two decisions in here do most of the work:
//
//   1. `label` lives ON the shape. The model never creates a separate text
//      element to caption a box. That is the single most common way an
//      LLM-drawn diagram falls apart: the caption is a free-floating text
//      element that does not move when the box moves.
//   2. Arrows carry `start: { id }` / `end: { id }`, not coordinates. The
//      model says WHAT connects to WHAT; Excalidraw computes where the arrow
//      actually attaches and keeps it attached when either shape moves.
//
// Everything is `.nullable()` rather than `.optional()`. That is not a style
// choice — see the note at the bottom of the file.
import { z } from "zod";

const label = z
  .object({
    text: z.string(),
    fontSize: z.number().nullable(),
  })
  .nullable()
  .describe(
    "Text drawn INSIDE this shape. Excalidraw centres and re-flows it for you.",
  );

const binding = z
  .object({ id: z.string() })
  .nullable()
  .describe("id of the shape this end of the arrow attaches to");

/** Fields every element has. */
const base = {
  id: z
    .string()
    .describe(
      "Short meaningful id: rect_user, arrow_user_api. Never element_42.",
    ),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  strokeColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
};

// z.union, NOT z.discriminatedUnion.
//
// They describe the same thing in TypeScript and compile to different JSON
// Schema: discriminatedUnion emits `oneOf`, and OpenAI's strict mode rejects it
// outright —
//
//   Invalid schema for function 'addElements':
//   In context=('properties','elements','items'), 'oneOf' is not permitted.
//
// z.union emits `anyOf`, which strict mode accepts. The model still picks the
// right branch from the `type` literal, so nothing is lost but the error.
export const elementSchema = z.union([
  z.object({ type: z.literal("rectangle"), ...base, label }),
  z.object({ type: z.literal("ellipse"), ...base, label }),
  z.object({ type: z.literal("diamond"), ...base, label }),
  z.object({
    type: z.literal("arrow"),
    ...base,
    label,
    // Without these two an arrow is a line at some coordinates: the model can
    // draw it, but it attaches to nothing and does not follow when a box moves.
    // They are the reason boundArrows goes from 17% to 100% in Part 5.
    start: binding,
    end: binding,
  }),
  z.object({ type: z.literal("line"), ...base, label }),
  z.object({
    // A standalone text element is for floating annotations — a title, a note
    // in the margin. It is NOT how you label a shape.
    type: z.literal("text"),
    ...base,
    text: z.string(),
    fontSize: z.number().nullable(),
  }),
]);

export type DiagramElement = z.infer<typeof elementSchema>;

// ---------------------------------------------------------------------------
// Why nullable and not optional
//
// OpenAI's strict structured outputs mode guarantees the model's arguments
// validate against your schema — no missing fields, no invented ones, no
// malformed JSON to parse defensively. The price is that strict mode does not
// support optional properties: every key in the object must be present in the
// output.
//
// So we mark "you may leave this out" as `.nullable()` instead, and the model
// sends `"strokeColor": null`. Our code strips nulls before handing the object
// to Excalidraw, which expects `undefined` for "use the default" and throws on
// `label: null`.
//
// Verbose on the wire, and worth it: with strict mode on, a whole category of
// runtime failure — the model returning something your code cannot parse —
// stops existing.
```

> ### `z.union`, not `z.discriminatedUnion`
>
> Those two describe the same thing in TypeScript and compile to different JSON
> Schema. `discriminatedUnion` emits `oneOf`; OpenAI's strict mode rejects it
> outright with `'oneOf' is not permitted`. `z.union` emits `anyOf`, which strict
> mode accepts, and the model still picks its branch from the `type` literal.
>
> An hour of confusion is hiding in that one word, and the error names the JSON
> Schema keyword rather than anything in your code, so it does not lead you back
> to the zod call that produced it.

### The four tools

**`src/tools/add-elements.ts`** · new file · 29 lines

```ts
import { tool } from "ai";
import { z } from "zod";
import { elementSchema } from "./element-schema";

// A CLIENT-SIDE tool: notice there is no `execute`.
//
// When the model calls a tool that has no execute function, the AI SDK does
// not run anything on the server. The call is streamed to the browser as part
// of the assistant message, the browser fulfils it (App.tsx applies the
// elements to the live Excalidraw scene) and sends a result back, and the
// agent loop resumes with that result in context.
//
// That is the whole architecture of this app in one sentence: the canvas lives
// in the browser, so the tools that touch the canvas run in the browser.
export const addElements = tool({
  description: `Add new elements to the canvas. Use this to draw a new diagram or to extend an existing one.

To put text inside a shape, set that shape's \`label\` field. Do NOT create a separate text element for it — a floating text element on top of a box is not a label and will not move with the box.

// 

`,
  inputSchema: z.object({
    elements: z.array(elementSchema).describe("The elements to add"),
  }),
  // Strict mode: the model physically cannot emit a call that fails to
  // validate. Pair it with the nullable fields in element-schema.ts.
  strict: true,
});
```

**`src/tools/update-elements.ts`** · new file · 42 lines

```ts
import { tool } from "ai";
import { z } from "zod";

// Client-side. The browser patches the named elements in place.
//
// This is the tool that makes the agent feel like a collaborator rather than a
// generator. Without it, "make the login box red" means redrawing the entire
// diagram — new ids, new positions, everything the user had moved by hand
// thrown away. With it, one element changes and the rest of the scene is
// untouched.
//
// Every field is nullable, and null means "leave this alone". Under OpenAI
// strict mode the model must send every key, so a recolour looks like:
//
//   { id: "rect_login", fields: { backgroundColor: "#fa5252", x: null, ... } }
//
// The browser strips the nulls before applying.
const fields = z.object({
  x: z.number().nullable(),
  y: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  text: z.string().nullable().describe("New label text for a shape, or new content for a text element"),
  strokeColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
});

export const updateElements = tool({
  description: `Change properties of elements that are already on the canvas. Pass null for every field you are not changing.

Prefer this over redrawing. If the user asks for one box to move or change colour, update that one box — do not delete the diagram and start again.

Call queryCanvas first unless you already know the ids from this conversation.

Example: updateElements({ updates: [
  { id: "rect_login", fields: { backgroundColor: "#fa5252", x: null, y: null, width: null, height: null, text: null, strokeColor: null } }
]})`,
  inputSchema: z.object({
    updates: z.array(z.object({ id: z.string(), fields })),
  }),
  strict: true,
});
```

The other two follow the same pattern — a description the model can act on, a
tiny schema, and no `execute`:

**`src/tools/remove-elements.ts`** · new file · 13 lines

```ts
import { tool } from "ai";
import { z } from "zod";

// Client-side. The browser deletes these ids from the scene.
export const removeElements = tool({
  description: `Delete elements from the canvas by id. The ids must be real — call queryCanvas first if you are not certain what is there.

Example: removeElements({ ids: ["rect_old", "arrow_stale"] })`,
  inputSchema: z.object({
    ids: z.array(z.string()).describe("Element ids to delete"),
  }),
  strict: true,
});
```

**`src/tools/query-canvas.ts`** · new file · 27 lines

```ts
import { tool } from "ai";
import { z } from "zod";

// Also client-side, and the most interesting of the four.
//
// The agent runs on a Worker. The canvas lives in a browser tab. So how does
// the agent know what is already drawn?
//
// The tempting answer is to serialise the scene into every request — append it
// to the system prompt, or to the user's message. That works, and it is what
// most people build first. It also means you pay for the whole canvas on every
// single turn, including the turns that are just "thanks" or "what can you
// do?", and it goes stale the moment the user drags a box.
//
// The better answer is this: make it a tool, and let the model decide when it
// needs to look. Nothing is spent on turns that do not touch the canvas, and
// when the model does ask, the browser answers from the live scene, so the
// answer cannot be stale.
export const queryCanvas = tool({
  description: `Read what is currently on the canvas. Returns every element with its id, type, position, size and label.

Call this BEFORE modifying or removing anything, so you use real ids instead of guessing. You do not need it before drawing a brand new diagram on an empty canvas.

Example: queryCanvas({})`,
  inputSchema: z.object({}),
  // No execute. The browser answers this one.
});
```

Then the registry. This file replaces the flat `src/tools.ts` from Part 2; delete
that one, and update the import in `src/agent-core.ts` from `"./tools"` (the
file) to `"./tools"` (the folder) — the specifier does not change, but make sure
the old file is gone or it will win:

**`src/tools/index.ts`** · new file — replaces src/tools.ts from Part 2 · 55 lines

```ts
// One place that assembles the tool set the agent is given.
//
// Four of the six are client-side (no execute — the browser fulfils them) and
// two are server-side. The two server-side ones need per-request secrets, so
// they are built by factory functions rather than exported as constants: a
// Worker gets its env per request, not from a module-level import.
import { addElements } from "./add-elements";
import { updateElements } from "./update-elements";
import { removeElements } from "./remove-elements";
import { queryCanvas } from "./query-canvas";
import { makeSearchWeb } from "./search-web";
import { makeSearchKnowledge } from "./search-knowledge";

export interface ToolEnv {
  TAVILY_API_KEY?: string;
  UPSTASH_VECTOR_REST_URL?: string;
  UPSTASH_VECTOR_REST_TOKEN?: string;
}

/**
 * A tool that cannot work should not be offered.
 *
 * Both search tools return `{ error }` when their credentials are missing —
 * which is the right shape for a RUNTIME failure, and entirely the wrong answer
 * to "this will never work". A model handed a tool that fails every time will
 * try it again, and again, and in a client-tool architecture (where every tool
 * result starts a fresh request with a fresh step budget) that is an infinite
 * loop with a bill attached.
 *
 * So the configuration check happens here, once, before the model ever sees the
 * menu. You cannot be tempted by a tool that is not on it — and the prompt stops
 * lying about capabilities the deployment does not have.
 */
export function buildTools(env: ToolEnv) {
  const tools: Record<string, unknown> = {
    queryCanvas,
    addElements,
    updateElements,
    removeElements,
  };

  if (env.TAVILY_API_KEY) tools.searchWeb = makeSearchWeb(env.TAVILY_API_KEY);
  if (env.UPSTASH_VECTOR_REST_URL && env.UPSTASH_VECTOR_REST_TOKEN) {
    tools.searchKnowledge = makeSearchKnowledge(env);
  }

  return tools as {
    queryCanvas: typeof queryCanvas;
    addElements: typeof addElements;
    updateElements: typeof updateElements;
    removeElements: typeof removeElements;
    searchWeb?: ReturnType<typeof makeSearchWeb>;
    searchKnowledge?: ReturnType<typeof makeSearchKnowledge>;
  };
}
```

### The browser side, properly this time

Excalidraw ships a helper, `convertToExcalidrawElements`, that turns exactly this
compact shape into a real scene — labels bound, arrows bound, defaults filled.
All that hand-written boilerplate from Part 2 goes away.

One thing the helper does not do: resolve a binding to a shape that is already on
the canvas from an earlier call. That is its own file, because the symptom
(arrows that attach on the first diagram and float on the second) is baffling
until someone tells you.

**`src/canvas/bindings.ts`** · new file · 79 lines

```ts
// Arrows that point at shapes drawn in an EARLIER call.
//
// `convertToExcalidrawElements` resolves `start`/`end` ids only within the
// batch you hand it. That is fine for "draw me a diagram" — shapes and arrows
// arrive together. It breaks the moment someone says "now add a cache between
// the API and the database": the new arrow names two shapes that are already
// on the canvas, the helper cannot see them, and you get an arrow lying
// unattached across the scene.
//
// The symptom is subtle and the cause is not obvious, which is exactly why it
// is worth its own file rather than four lines buried in a click handler.
//
// The fix is two-sided, because Excalidraw stores every binding twice:
//   - the arrow knows its endpoints        (startBinding / endBinding)
//   - each shape knows its arrows          (boundElements)
// Miss the second half and the arrow attaches, but dragging the box leaves it
// behind.

interface Bindable {
  id: string;
  startBinding?: unknown;
  endBinding?: unknown;
}

export interface PendingBinding {
  id: string;
  type: "arrow";
}

/**
 * Patch arrows in `converted` that reference ids in `existingIds`, and report
 * which existing shapes need a back-reference adding.
 */
export function bindAcrossCalls(
  raw: Record<string, unknown>[],
  converted: Bindable[],
  existingIds: Set<string>
): Map<string, PendingBinding[]> {
  const backRefs = new Map<string, PendingBinding[]>();

  const remember = (shapeId: string, arrowId: string) => {
    const list = backRefs.get(shapeId) ?? [];
    list.push({ id: arrowId, type: "arrow" });
    backRefs.set(shapeId, list);
  };

  for (const el of raw) {
    if (el.type !== "arrow") continue;
    const arrow = converted.find((c) => c.id === el.id);
    if (!arrow) continue;

    for (const [end, key] of [
      ["start", "startBinding"],
      ["end", "endBinding"],
    ] as const) {
      const target = (el[end] as { id?: string } | undefined)?.id;
      // Only fill in what the helper left empty, and only for shapes that are
      // genuinely on the canvas — an id nobody ever created stays unbound so
      // the mistake is visible instead of silently repaired.
      if (!target || !existingIds.has(target) || arrow[key]) continue;
      (arrow as unknown as Record<string, unknown>)[key] = { elementId: target, focus: 0, gap: 4 };
      remember(target, el.id as string);
    }
  }

  return backRefs;
}

/** Merge new arrow references into a shape's existing boundElements. */
export function mergeBoundElements(
  existing: readonly { id: string; type: string }[] | null | undefined,
  incoming: PendingBinding[]
): { id: string; type: string }[] {
  const merged = [...(existing ?? [])];
  for (const binding of incoming) {
    if (!merged.some((b) => b.id === binding.id)) merged.push(binding);
  }
  return merged;
}
```

**`src/App.tsx`** · REPLACES the Part 2 version · 160 lines

```tsx
// The browser half of the agent.
//
// Four of the six tools have no `execute` on the Worker. This file is their
// implementation: `onToolCall` receives the call, does the thing to the live
// Excalidraw scene, and posts a result back so the agent loop can continue.
//
// Worth sitting with for a second, because it is the shape of every
// browser-driven agent you will build: the model is running somewhere else,
// and the thing it is manipulating is here. The tool call is the seam.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  convertToExcalidrawElements,
  CaptureUpdateAction,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "./components/Canvas";
import Chat from "./components/Chat";
import { serializeCanvasState } from "./canvas/serialize";
import { findOverlaps } from "./canvas/overlaps";
import { bindAcrossCalls, mergeBoundElements } from "./canvas/bindings";
import "./App.css";

// One agent instance per page load. The canvas lives only in this tab, so a
// persisted conversation would come back referring to a diagram that no longer
// exists — worse than starting fresh.
const sessionId = crypto.randomUUID();

// Our schemas use nullable rather than optional (see element-schema.ts), so the
// model sends every field and fills the unused ones with null. Excalidraw's
// skeleton helper wants `undefined` for "use the default" and throws on
// `label: null`. Recursive, because nested objects carry nulls too.
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  // onToolCall is captured once when the hook initialises, so reading `api`
  // from state inside it would pin the first (null) value forever. The ref is
  // always current.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const agent = useAgent({ agent: "design-agent", name: sessionId });

  const { messages, sendMessage, status } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      const scene = apiRef.current;
      const reply = (output: unknown) =>
        addToolOutput({ toolCallId: toolCall.toolCallId, output });

      if (!scene) return reply({ error: "canvas not ready" });

      switch (toolCall.toolName) {
        case "queryCanvas": {
          return reply({ summary: serializeCanvasState(scene.getSceneElements() as unknown[]) });
        }

        case "addElements": {
          const { elements } = toolCall.input as { elements: unknown[] };
          const cleaned = elements.map(stripNulls) as Record<string, unknown>[];

          // Expand the model's compact elements into real Excalidraw ones:
          // labels become bound text, arrow ids become bindings.
          const drawn = convertToExcalidrawElements(cleaned as never, { regenerateIds: false });

          // …then repair the bindings that point at shapes from earlier calls.
          const existing = scene.getSceneElements();
          const backRefs = bindAcrossCalls(
            cleaned,
            drawn as unknown as { id: string; startBinding?: unknown; endBinding?: unknown }[],
            new Set(existing.map((el) => el.id))
          );
          const patched = existing.map((el) => {
            const incoming = backRefs.get(el.id);
            if (!incoming) return el;
            return newElementWith(el, {
              boundElements: mergeBoundElements(el.boundElements, incoming),
            } as never);
          });

          const next = [...patched, ...drawn];
          scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          scene.scrollToContent(next, { fitToContent: true });

          // The result is feedback, not an acknowledgement: tell the model what
          // it just put on top of what, and it will move things apart.
          return reply({ added: drawn.length, overlaps: findOverlaps(next as unknown[]) });
        }

        case "updateElements": {
          const { updates } = toolCall.input as {
            updates: { id: string; fields: Record<string, unknown> }[];
          };
          const all = scene.getSceneElements();

          const next = all.map((el) => {
            // A shape's label is a separate bound text element, so "change the
            // text" lands on the child, not on the box.
            const forLabel = updates.find(
              (u) => u.id === (el as { containerId?: string }).containerId && u.fields.text != null
            );
            if (forLabel) return newElementWith(el, { text: forLabel.fields.text } as never);

            const update = updates.find((u) => u.id === el.id);
            if (!update) return el;
            const fields: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(update.fields)) {
              if (v !== null && k !== "text") fields[k] = v;
            }
            if (el.type === "text" && update.fields.text != null) fields.text = update.fields.text;
            return Object.keys(fields).length ? newElementWith(el, fields as never) : el;
          });

          scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          return reply({ updated: updates.map((u) => u.id), overlaps: findOverlaps(next as unknown[]) });
        }

        case "removeElements": {
          const { ids } = toolCall.input as { ids: string[] };
          const doomed = new Set(ids);
          const next = scene
            .getSceneElements()
            .filter(
              (el) => !doomed.has(el.id) && !doomed.has((el as { containerId?: string }).containerId ?? "")
            );
          scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          return reply({ removed: ids });
        }

        default:
          return reply({ error: `unknown client tool: ${toolCall.toolName}` });
      }
    },
  });

  const handleApi = useCallback((instance: ExcalidrawImperativeAPI) => setApi(instance), []);

  return (
    <div className="app">
      <Canvas onApiReady={handleApi} />
      <Chat messages={messages} sendMessage={sendMessage} status={status} />
    </div>
  );
}
```

### The eval needs the same expansion

The headless canvas has no Excalidraw, so it would score the model's raw claims
instead of what the canvas would actually render — "I set a label" would pass
even when nothing rendered.

**`src/canvas/skeleton.ts`** · new file · 85 lines

```ts
// A tiny stand-in for Excalidraw's `convertToExcalidrawElements`.
//
// In the browser, the model's compact element ("a rectangle with a label") is
// expanded by Excalidraw into what the scene actually holds: the rectangle,
// PLUS a separate text element bound to it by containerId, PLUS the
// boundElements back-reference. Arrows get startBinding/endBinding resolved
// from the ids the model supplied.
//
// The eval has no browser. If it scored the model's raw output it would be
// grading a claim rather than a drawing — "I labelled the box" would pass even
// when the label never rendered. So the eval expands the same way, here, and
// the scorers read the expanded scene.
//
// This is the general shape of honest offline evaluation: run the model's
// output through as much of the real pipeline as you can before you score it.
import type { DiagramElement } from "../tools/element-schema";

type Any = Record<string, unknown>;

export function applySkeleton(elements: unknown[], existingIds: Iterable<string> = []): Any[] {
  const out: Any[] = [];
  // Ids an arrow may legally bind to: the ones in this batch, plus whatever is
  // already on the canvas. The browser does the same repair in
  // canvas/bindings.ts — if the eval skipped it, it would report unbound
  // arrows on every "add X between Y and Z" case that production handles fine.
  const known = new Set<string>(existingIds);
  for (const el of elements as (DiagramElement & Any)[]) known.add(el.id);

  for (const el of elements as (DiagramElement & Any)[]) {
    const { label, start, end, ...rest } = el as Any & {
      label?: { text?: string; fontSize?: number | null } | null;
      start?: { id?: string } | null;
      end?: { id?: string } | null;
    };

    const shape: Any = { ...rest, boundElements: [] as { id: string; type: string }[] };

    // Arrow bindings: only resolve ids that exist. An arrow pointing at a
    // shape nobody created is a floating arrow, and the eval should see it
    // as one rather than quietly repairing it.
    if (el.type === "arrow") {
      shape.startBinding = start?.id && known.has(start.id) ? { elementId: start.id } : null;
      shape.endBinding = end?.id && known.has(end.id) ? { elementId: end.id } : null;
    }

    out.push(shape);

    // A shape label becomes a child text element, exactly as Excalidraw does.
    if (label?.text) {
      const textId = `${el.id}_label`;
      out.push({
        id: textId,
        type: "text",
        text: label.text,
        fontSize: label.fontSize ?? 20,
        containerId: el.id,
        // Centred in the container, like the real thing.
        x: (el.x ?? 0) + (el.width ?? 0) / 4,
        y: (el.y ?? 0) + (el.height ?? 0) / 2 - 10,
        width: Math.max(10, (el.width ?? 0) / 2),
        height: 20,
      });
      (shape.boundElements as { id: string; type: string }[]).push({ id: textId, type: "text" });
    }
  }

  // Back-references from shapes to the arrows that bind them. Excalidraw keeps
  // these so moving a box drags its arrows along.
  for (const el of out) {
    if (el.type !== "arrow") continue;
    for (const key of ["startBinding", "endBinding"] as const) {
      const binding = el[key] as { elementId: string } | null;
      if (!binding) continue;
      const target = out.find((candidate) => candidate.id === binding.elementId);
      if (target) {
        (target.boundElements as { id: string; type: string }[]).push({
          id: el.id as string,
          type: "arrow",
        });
      }
    }
  }

  return out;
}
```

### Check — the first real move

```bash
npm run eval:local
```

```
                   before   after
  boundArrows        17%  →  100%
  boundLabels        37%  →  100%
  toolChoice         79%  →  100%
  judge              57%  →   95%
  overall            75%  →   99%
```

A tool schema bought 24 points. No prompt engineering, no bigger model, no
retries. The agent did not get smarter — the space of things it could get wrong
got smaller.

> **Carry this out of the week.** When an agent keeps making a mistake, ask
> whether the mistake should be *possible*. Prompts ask for compliance; schemas
> remove the option.

---

## Part 6 — let the agent look at the canvas

| file | |
|---|---|
| `src/canvas/serialize.ts` | no change — this part is about why it looks like that |
| `src/App.tsx` | the `queryCanvas` branch of `onToolCall`, added in Part 5 |

`queryCanvas` is in the tool set from Part 5, and the `toolChoice` score above
depends on it — this part is about the file that makes its answer cheap.

The tempting alternative is to serialise the canvas into every request. It works,
it is what most people build first, and it is wrong twice over: you pay for the
whole canvas on turns that never mention it, and the copy goes stale the moment
the user drags a box.

You wrote `src/canvas/serialize.ts` in Part 4, because the judge needed it. Open
it again now and read it as a design decision rather than a utility.

A six-box diagram costs about 4,000 tokens as raw Excalidraw JSON and about 120
through this function. More importantly, it is now *legible* — the model reads
`rect_login — rectangle at (100, 100) 240x100 labelled "Login"` rather than
thirty fields of bookkeeping.

### Check

In the browser: draw a diagram, then say **"make the Login box red"**. Watch the
transcript: `queryCanvas` first, then `updateElements` with the real id. Then
drag a box and ask again — it reads the *current* positions, because the browser
is the source of truth and there is no cached copy to go stale.

---

## Part 7 — feedback in the tool result, and the prompt

| file | |
|---|---|
| `src/system-prompt.ts` | **replace** — the long prompt, in place of Part 2's |
| `src/App.tsx` | already returns `overlaps` from `addElements` (Part 5) |

Models are bad at coordinates. You can attack that two ways, and you should do
both, in this order.

**Evidence after the fact.** `findOverlaps` is already wired into the tool
result, so the model reads `overlaps: [["rect_api","rect_db"]]` the way it reads
any other tool output — and the prompt tells it what to do about that:

> Every addElements result carries an `overlaps` list. If it is not empty, your
> next call moves those elements apart.

A tool result is not an acknowledgement. It is the one channel where you can
hand the model evidence about the world it just changed, and most tools waste it
on `{ ok: true }`.

**Advice before the fact.** The layout grid: fixed sizes, fixed strides, fixed
origin. Not "space things nicely" — actual numbers the model can follow
mechanically.

**`src/system-prompt.ts`** · REPLACES the Part 2 prompt · 97 lines

```ts
// The system prompt, in its own file so the Worker and the eval harness read
// the same one. If the eval scored a different prompt than production ships,
// every number it produced would be fiction.
//
// Read this as a record of failures. Nearly every line was added because a
// specific thing went wrong on the canvas, in front of someone, and the fix
// was cheaper in prose than in code. Parts 4 and 6 of the workshop build it in
// that order: measure, find the failure, write the line, measure again.

export const SYSTEM_PROMPT = `# Role

You are a diagram design assistant driving an Excalidraw canvas. Your subject is
technical diagrams: architecture, sequence, flowchart, state machine, ER. You are
not a chat bot — you translate what the user asks for into tool calls that draw it.

# Tools

- **queryCanvas()** — read what is on the canvas. Call this FIRST whenever the
  request touches something that already exists.
- **addElements(elements)** — draw new elements.
- **updateElements(updates)** — change existing elements by id.
- **removeElements(ids)** — delete by id.
- **searchWeb(query)** — look something up when the request names a system whose
  details you may not know. Search first, then draw.
- **searchKnowledge(query)** — search the private reference corpus. Use it before
  drawing anything domain-specific where precision matters.

# Hard rules

Break one of these and the diagram is broken, however good the reply text is.

1. **Label shapes with the shape's own \`label\` field.** Never create a separate
   text element to caption a box. A floating text element is not a label: it does
   not move with the box and it does not re-flow.
2. **Every connecting arrow binds both ends.** Set \`start: { id }\` and
   \`end: { id }\` to real shape ids. An arrow without both is a line lying on the
   canvas pretending to be a connection.
3. **Nothing smaller than 20x20.** No zero-size shapes, no empty text.
4. **Nothing overlapping.** Two boxes in the same place is always a bug.
5. **Readable ids.** \`rect_user\`, \`arrow_user_api\`. Never \`element_42\`, never a uuid.

# Layout grid

You are bad at coordinates. Do not improvise them — follow this grid.

- Rectangle: 240x100. Ellipse and diamond: 140x140.
- Horizontal stride between neighbours: 320. Vertical stride between rows: 180.
- First element at (100, 100).
- So a row is x = 100, 420, 740, 1060; a column is y = 100, 280, 460, 640.

**Long labels need wider shapes.** 240px fits about two short words. Otherwise
width = max(240, 14 x number of characters), and push everything to the right of
it along by the same amount.

**Labelled arrows need more room.** An arrow label sits on the arrow's midpoint
and spreads both ways. If your arrows carry labels, use a stride of at least 400
and keep the labels short: "login", not "1. send the login request".

# Patterns

- **Architecture** — rectangles for services, arrows for calls, data flowing left
  to right.
- **Sequence** — actors in a row at y=100, a thin tall rectangle under each as its
  lifeline, numbered arrows between lifelines in time order.
- **Flowchart** — rectangles for steps, diamonds for decisions, top to bottom; a
  decision has two outgoing arrows labelled "yes" and "no".
- **State machine** — ellipses for states, arrows labelled with the trigger.
- **ER** — rectangles for entities, lines labelled with cardinality.

# How to work

- **Act on the overlaps you are told about.** Every addElements result carries an
  \`overlaps\` list. If it is not empty, your next call moves those elements apart.
  Do not leave overlaps in the finished diagram.
- **Query before you modify.** "Make the login box red" means queryCanvas, find
  the id, then updateElements. Never guess an id.
- **Change, do not redraw.** One box moved is one updateElements call, not a new
  diagram.
- **Leave the rest alone.** When you add to an existing canvas, do not restyle or
  delete what the user did not mention.
- **Draw something.** If the request is a diagram request, the reply that contains
  no tool call is always wrong. Ask a clarifying question only when the request is
  genuinely ambiguous — otherwise make a reasonable choice and draw.

# Worked example

User: "draw a flow from User to API to Database"

Architecture pattern, three boxes in a row, two bound arrows — five elements:

1. \`rect_user\` rectangle (100, 100) 240x100, label "User"
2. \`rect_api\` rectangle (420, 100) 240x100, label "API"
3. \`rect_db\` rectangle (740, 100) 240x100, label "Database"
4. \`arrow_user_api\` arrow, start rect_user, end rect_api
5. \`arrow_api_db\` arrow, start rect_api, end rect_db

The labels are properties of the boxes. The arrows name the boxes they join.`;
```

### Check — and the result nobody promises you

```bash
npm run eval:local
```

```
                  before   after
  noOverlaps        90%  →  100%
  judge             95%  →   92%
  overall           99%  →   99%
```

**The aggregate did not move.** A long, careful, well-argued prompt — the kind
that takes an hour to write — bought nothing measurable on this dataset.

Do not delete it. Look closer: the overlap score went to 100%, and the judge
wobbled by three points, which on fourteen cases and a single run is noise. The
prompt fixed the thing it was aimed at. The aggregate hid it because the other
scorers were already at 100%.

Two lessons, and the second is the one that makes you an engineer rather than a
prompt tinkerer:

1. **A ceiling is not a result.** When scorers sit at 100% they can no longer
   tell you anything. Harder cases, or you are flying blind.
2. **Single runs are noisy.** Before you claim a three-point improvement, run it
   three times and look at the spread. Most reported agent improvements are
   inside the noise band of the eval that measured them.

---

## Part 8 — facts from the web

| file | |
|---|---|
| `src/tools/search-web.ts` | new |
| `src/tools/index.ts` | **edit** — offer `searchWeb` when a key is configured |
| `src/agent.ts` | **edit** — the turn budget (see "the bill-shaped bug") |
| `src/agent-core.ts` | **edit** — `describeMissing`, and pass `toolChoice`/`extraSystem` through |

The first tool with an `execute` on the server, because nothing about it touches
the canvas.

**`src/tools/search-web.ts`** · new file · 75 lines

```ts
import { tool } from "ai";
import { z } from "zod";

// The first SERVER-side tool: this one has an execute, and it runs on the
// Worker. Nothing about it touches the canvas, so there is no reason to make
// the browser do it.
//
// It is also the first of the three ways to get facts into a model, and it is
// worth naming all three while they are next to each other:
//
//   system prompt  — facts the model should ALWAYS have. Cheap to write,
//                    expensive to keep: you pay for them on every request.
//   a tool (here)  — facts fetched ON DEMAND, when the model decides it needs
//                    them. You pay only when it asks.
//   retrieval      — same on-demand shape, but the source is YOUR corpus
//                    rather than the open web. That is Part 8.
//
// Note the error handling: a failed search returns `{ error }` as a normal
// tool result. It does not throw. A model that receives "Tavily returned 401"
// can tell the user it could not search; a model whose tool threw sees the
// whole agent loop die.
interface TavilyResult { title?: string; content?: string; url?: string }

export function makeSearchWeb(apiKey: string | undefined) {
  return tool({
    description: `Search the web for current information. Use it when the user asks you to draw a system, product or protocol whose details you may not know accurately — search first, then draw.

Example: searchWeb({ query: "how Cloudflare Durable Objects handle concurrent requests" })`,
    inputSchema: z.object({
      query: z.string().describe("What to search for"),
      maxResults: z.number().optional().describe("Default 5"),
    }),
    execute: async ({ query, maxResults }) => {
      // buildTools does not offer this tool without a key, so this branch is a
      // backstop rather than the main path.
      if (!apiKey) {
        return {
          error:
            "Web search is not configured. Do not call searchWeb again in this " +
            "conversation; draw from what you know and say so.",
        };
      }
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: maxResults ?? 5,
            search_depth: "basic",
          }),
        });
        if (!res.ok) return { error: `Tavily returned ${res.status}` };
        const data = (await res.json()) as { results?: TavilyResult[] };
        // Hand back the three fields the model can use and drop the rest of
        // Tavily's payload. A tool result is context you are paying for.
        return {
          results: (data.results ?? []).map((r) => ({
            title: r.title ?? "",
            content: r.content ?? "",
            url: r.url ?? "",
          })),
        };
      } catch (err) {
        return {
          error:
            `Search failed (${err instanceof Error ? err.message : String(err)}). ` +
            `Do not retry the same query — draw from what you know and say the ` +
            `lookup did not work.`,
        };
      }
    },
  });
}
```

### Check

Ask for something the model cannot know accurately: *"draw the architecture of
how Cloudflare Durable Objects handle a request"*. Watch for `searchWeb` in the
transcript before `addElements`.

### The bill-shaped bug

Now do what a student will do by accident: run the app with **no**
`TAVILY_API_KEY` and ask for something it wants to look up — *"create the
YouTube design pattern"*.

Here is what happened the first time this workshop was used:

```
searchKnowledge searchWeb addElements
searchKnowledge searchWeb addElements
searchKnowledge searchWeb addElements
…150 more times
```

Every search failed, because neither service was configured. The model read the
error, tried the other tool, drew something anyway, then started over — and each
round trip was a **new request with a fresh step budget**, so nothing ever
stopped it. The canvas was redrawn 150 times and every round was billed.

Three separate mistakes, and it is worth naming all three because they are
independent:

**1. A tool that cannot work was on the menu.** Both search tools were offered
whether or not their credentials existed. The fix is not a better error message
— it is not offering the tool:

**`src/tools/index.ts`** · REPLACES the buildTools from Part 5 · lines 20–45 of the finished file

```ts
/**
 * A tool that cannot work should not be offered.
 *
 * Both search tools return `{ error }` when their credentials are missing —
 * which is the right shape for a RUNTIME failure, and entirely the wrong answer
 * to "this will never work". A model handed a tool that fails every time will
 * try it again, and again, and in a client-tool architecture (where every tool
 * result starts a fresh request with a fresh step budget) that is an infinite
 * loop with a bill attached.
 *
 * So the configuration check happens here, once, before the model ever sees the
 * menu. You cannot be tempted by a tool that is not on it — and the prompt stops
 * lying about capabilities the deployment does not have.
 */
export function buildTools(env: ToolEnv) {
  const tools: Record<string, unknown> = {
    queryCanvas,
    addElements,
    updateElements,
    removeElements,
  };

  if (env.TAVILY_API_KEY) tools.searchWeb = makeSearchWeb(env.TAVILY_API_KEY);
  if (env.UPSTASH_VECTOR_REST_URL && env.UPSTASH_VECTOR_REST_TOKEN) {
    tools.searchKnowledge = makeSearchKnowledge(env);
  }
```

**2. The prompt advertised tools that were not there.** The system prompt names
six tools, so the model announced lookups it had no way to perform. One
canonical prompt plus a line of errata per deployment:

**`src/agent-core.ts`** · ADD above MAX_STEPS · lines 31–52 of the finished file

```ts
/**
 * The system prompt names six tools. A deployment without a Tavily key or an
 * Upstash index only has four, and a prompt that advertises tools the model
 * cannot call produces exactly the failure you would expect: it announces that
 * it will look something up, tries, fails, and tries again.
 *
 * One canonical prompt, plus a line of errata per deployment.
 */
function describeMissing(tools: Record<string, unknown>): string | undefined {
  const missing = ["searchWeb", "searchKnowledge"].filter((name) => !tools[name]);
  if (!missing.length) return undefined;
  return (
    `NOT AVAILABLE in this deployment: ${missing.join(" and ")}. ` +
    `Ignore every mention of ${missing.length > 1 ? "them" : "it"} above. Do not ` +
    `announce lookups you cannot perform — draw from what you know, and say when ` +
    `a detail is your best guess rather than something you checked.`
  );
}

// A diagram takes a handful of steps: look, draw, fix the overlaps, reply.
// Eight is generous. The limit exists so a confused model cannot loop forever
// on your account — the same rule as any agent loop.
```

**3. There was no bound on the turn.** This is the important one, and it is the
`stopWhen` trap from Part 2 arriving. The bound has to live where the state
lives — in the Durable Object, across requests:

**`src/agent.ts`** · ADD above the class · lines 25–50 of the finished file

```ts
/**
 * How many model calls one user message may cost.
 *
 * THIS IS NOT `stopWhen: stepCountIs(8)`, and the difference is the most
 * expensive thing in this file.
 *
 * `stopWhen` bounds the steps inside a single streamText call. That is a real
 * bound only while the tools run on the server: the loop happens inside one
 * request, and the counter sees every step of it.
 *
 * Our canvas tools run in the BROWSER. The Worker streams a tool call out, the
 * request ends, the browser draws and posts the result back — and that is a
 * NEW request, a new onChatMessage, a new streamText, with the step counter
 * starting again at zero. Nothing accumulates. An agent that keeps calling
 * tools keeps getting a fresh budget, forever.
 *
 * That is not theoretical. Ask this agent to draw something it wants to look up
 * with a search tool that is not configured, and it will cheerfully cycle
 * search → search → draw → search → draw a hundred and fifty times, billing you
 * for every round and redrawing the canvas on each one.
 *
 * So the bound has to live where the state lives: in the Durable Object, across
 * requests. Count the assistant turns since the user last said something, and
 * when the budget is gone, take the tools away and make it answer.
 */
const TURN_BUDGET = 10;
```

…and then, when the budget is gone, take the tools away for the rest of the turn:

**`src/agent.ts`** · REPLACES the Part 1 body · lines 53–86 of the finished file

```ts
  async onChatMessage() {
    const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });

    // Everything after the user's most recent message is work done on this
    // turn. Each client round trip leaves one assistant message behind.
    const roles = this.messages.map((m: { role: string }) => m.role);
    const lastUser = roles.lastIndexOf("user");
    const spent = roles.slice(lastUser + 1).filter((role) => role === "assistant").length;

    const exhausted = spent >= TURN_BUDGET;

    const result = streamAgent({
      model: openai.chat("gpt-5.4"),
      messages: await convertToModelMessages(this.messages),
      // Out of budget: no more tools this turn. `toolChoice: "none"` leaves the
      // tool definitions in context — so the model can still talk about what it
      // did — while making another call impossible. The loop ends here whether
      // the model agrees or not.
      toolChoice: exhausted ? "none" : undefined,
      extraSystem: exhausted
        ? `You have used every tool call available for this turn. Do not describe ` +
          `further work you intend to do. Tell the user plainly what you managed ` +
          `to draw, what you could not, and stop.`
        : undefined,
      env: {
        TAVILY_API_KEY: this.env.TAVILY_API_KEY,
        UPSTASH_VECTOR_REST_URL: this.env.UPSTASH_VECTOR_REST_URL,
        UPSTASH_VECTOR_REST_TOKEN: this.env.UPSTASH_VECTOR_REST_TOKEN,
      },
    });

    return result.toUIMessageStreamResponse();
  }
}
```

Those two new arguments — `toolChoice` and `extraSystem` — have to reach
`streamText`, so `streamAgent` grows a little:

**`src/agent-core.ts`** · REPLACES the Part 1 version · lines 74–98 of the finished file

```ts
/** Live chat. Tool calls stream to the browser; the browser draws. */
export function streamAgent({
  model,
  messages,
  system = SYSTEM_PROMPT,
  extraSystem,
  toolChoice,
  maxSteps = MAX_STEPS,
  env = {},
}: AgentArgs) {
  const tools = buildTools(env);
  const notes = [describeMissing(tools), extraSystem].filter(Boolean);

  return streamText({
    model,
    system: notes.length ? `${system}\n\n${notes.join("\n\n")}` : system,
    messages,
    tools,
    ...(toolChoice ? { toolChoice } : {}),
    // Bounds the steps WITHIN this request. It is not a bound on the turn —
    // see the comment on TURN_BUDGET in agent.ts, which is the one that stops
    // a client-tool loop.
    stopWhen: stepCountIs(maxSteps),
  });
}
```

`toolChoice: "none"` leaves the tool definitions in context, so the model can
still explain what it did, while making another call impossible. The loop ends
whether the model agrees or not.

> **Why the eval could not catch this.** In `runAgent` every tool executes
> in-process, so the whole loop happens inside one `generateText` call and
> `stepCountIs` really does bound it. The runaway only exists in the client
> round-trip path, which the eval does not have. A harness that simulates your
> architecture will miss the bugs that *are* your architecture — which is an
> argument for using the thing you built, by hand, before you trust the number.

---

## Part 9 — facts from your own corpus

| file | |
|---|---|
| `corpus/*.md` | new — your reference documents |
| `src/rag/vector-store.ts` | new |
| `src/rag/embed.ts` | new |
| `src/tools/search-knowledge.ts` | new |
| `src/tools/index.ts` | **edit** — offer `searchKnowledge` when Upstash is configured |
| `package.json` | **edit** — add the `embed` script |

Ask the agent to draw *your* deployment pipeline and it will draw *a* deployment
pipeline, confidently, from the average of every pipeline it has read. It cannot
know yours. That is the `domain-01` case in the dataset, and it has been failing
since Part 3.

**`corpus/deployment-pipeline.md`** · your own reference doc — this one is an example · lines 1–18 of the finished file

```md
# Deployment pipeline

Every change follows the same path from a developer's laptop to production.

1. **Pull request** — a branch is opened against `main`. Opening the PR triggers
   the CI workflow.
2. **CI checks** — lint, typecheck and unit tests run in parallel. All three must
   pass before review is allowed.
3. **Review** — one approval from a code owner is required. The PR cannot merge
   without it.
4. **Merge to main** — merging builds a container image tagged with the commit sha
   and pushes it to the registry.
5. **Deploy to staging** — the new image is deployed to staging automatically. No
   human step. Smoke tests run against staging for ten minutes.
6. **Manual promotion** — a release manager promotes the staging image to
   production. This is the only manual gate in the pipeline.
7. **Production rollout** — the image rolls out to 10% of traffic for fifteen
   minutes, then to 100% if the error rate stays flat.
```

**`src/rag/vector-store.ts`** · new file · 23 lines

```ts
import { Index } from "@upstash/vector";

// One place that knows how to reach the vector index.
//
// Upstash embeds for us: we send text, it runs the embedding model server-side
// and stores the vector. That removes a whole moving part from the workshop —
// no embedding API call of our own, no dimension mismatch, no vector maths.
// The ideas are identical to a local store: chunk, embed, upsert, query by
// cosine similarity, take the top K.
export interface VectorEnv {
  UPSTASH_VECTOR_REST_URL?: string;
  UPSTASH_VECTOR_REST_TOKEN?: string;
}

export function getIndex(env: VectorEnv): Index {
  if (!env.UPSTASH_VECTOR_REST_URL || !env.UPSTASH_VECTOR_REST_TOKEN) {
    throw new Error("Upstash Vector is not configured");
  }
  return new Index({
    url: env.UPSTASH_VECTOR_REST_URL,
    token: env.UPSTASH_VECTOR_REST_TOKEN,
  });
}
```

**`src/rag/embed.ts`** · new file · 68 lines

```ts
// Load the corpus into the vector index. Run it once, and again whenever the
// files under corpus/ change:
//
//   npm run embed
//
// Three steps, and they are the whole of RAG's write path:
//   read the documents → cut them into chunks → upsert each chunk
//
// The chunking here is deliberately dumb: split on blank lines, then glue the
// small pieces back together until each chunk is a few hundred characters. For
// short reference docs that is enough, and it keeps the interesting decision
// visible rather than hidden in a library. The interesting decision is: a chunk
// should be the smallest thing that still makes sense on its own. Too small and
// you retrieve a fragment with no context; too big and you spend the model's
// attention on paragraphs nobody asked for.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getIndex } from "./vector-store";

const TARGET = 700; // characters per chunk, roughly

function chunk(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > TARGET) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

const index = getIndex({
  UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL,
  UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

const files = readdirSync("corpus").filter((f) => f.endsWith(".md"));
let total = 0;

for (const file of files) {
  const text = readFileSync(join("corpus", file), "utf8");
  // Keep the document's title on every chunk from it. A chunk that starts
  // "3. The user authenticates…" is nearly useless on its own; the same chunk
  // under "# OAuth 2.0 authorization code flow" is retrievable and readable.
  const title = text.split("\n")[0]?.replace(/^#\s*/, "") ?? file;
  const pieces = chunk(text);

  for (const [i, content] of pieces.entries()) {
    const body = `${title}\n\n${content}`;
    await index.upsert({
      id: `${file}#${i}`,
      // Upstash embeds this text for us — no embedding call of our own.
      data: body,
      // …but it does not hand the text back on query, only metadata. So we
      // store a copy here, which is what searchKnowledge returns to the model.
      metadata: { source: file, content: body },
    });
    total++;
  }
  console.log(`  ${file}: ${pieces.length} chunk(s)`);
}

console.log(`\n  ${total} chunks upserted from ${files.length} file(s)\n`);
```

**`src/tools/search-knowledge.ts`** · new file · 46 lines

```ts
import { tool } from "ai";
import { z } from "zod";
import { getIndex, type VectorEnv } from "../rag/vector-store";

// The RAG tool. Same shape as searchWeb — server-side, on-demand, errors as
// data — pointed at your own corpus instead of the internet.
//
// Why a diagram agent wants this: ask a model to draw "our deployment
// pipeline" and it will draw A deployment pipeline, confidently, from the
// average of everything it has read. It cannot know yours. Three paragraphs of
// retrieved reference text turn a plausible diagram into a correct one.
//
// The retrieved text goes back as a tool result, which means the model reads
// it and then draws. You are not asking it to copy; you are giving it the
// facts it was about to invent.
export function makeSearchKnowledge(env: VectorEnv) {
  return tool({
    description: `Search the private knowledge base for reference material about a system, protocol or process before drawing it. Use it whenever the request names something specific where the details matter and you might be guessing.

Example: searchKnowledge({ query: "OAuth 2.0 authorization code flow with PKCE" })`,
    inputSchema: z.object({
      query: z.string().describe("What you need to know, in natural language"),
    }),
    execute: async ({ query }) => {
      try {
        const results = await getIndex(env).query({ data: query, topK: 3, includeMetadata: true });
        return {
          results: results.map((r) => ({
            source: (r.metadata as { source?: string } | undefined)?.source ?? String(r.id),
            content: (r.metadata as { content?: string } | undefined)?.content ?? "",
            score: r.score,
          })),
        };
      } catch (err) {
        // Say "stop", not just "sorry". A tool result that reads like a
        // transient hiccup invites the model to try again, and again.
        return {
          error:
            `The knowledge base is unavailable (${err instanceof Error ? err.message : String(err)}). ` +
            `Do not call searchKnowledge again in this conversation. Draw from what you ` +
            `know and tell the user you could not consult the reference material.`,
        };
      }
    },
  });
}
```

### Check

```bash
npm run embed          # once, and again whenever corpus/ changes
npm run eval:local -- --case domain
```

The `domain-01` case should go from failing to passing: the diagram now has a
staging step before production and a manual promotion gate, because those facts
came back from the corpus instead of being invented.

> **When RAG is the wrong answer.** If the facts fit in the system prompt and
> rarely change, put them in the system prompt — you have just saved yourself a
> vector database. Retrieval earns its complexity when the corpus is too big to
> send, changes independently of your deploys, or is private. "We added RAG" is
> not an achievement; "the domain case went from 33% to 100%" is.

---

## Part 10 — ship it, and say what moved

Run the whole suite one more time and put it next to the baseline from Part 4.

| scorer | Part 4 baseline | final | what bought it |
|---|---|---|---|
| boundArrows | 17% | 100% | the schema |
| boundLabels | 37% | 100% | the schema |
| toolChoice | 79% | 100% | `queryCanvas` |
| noOverlaps | 75% | 100% | overlap feedback + the layout grid |
| judge | 57% | 92% | all of the above |
| **overall** | **75%** | **99%** | |

Then look at what that table does not say:

- **The prompt is not in it.** An hour of prompt writing moved the aggregate by
  zero. It fixed overlaps specifically, which the grid targeted, and nothing
  else. You would not have known that without the per-scorer breakdown.
- **Everything at 100% is now blind.** Five scorers have nothing left to tell
  you. Your next job is not another feature, it is harder cases.
- **One run each.** These are single measurements on fourteen cases. Treat
  anything under five points as noise until you have run it three times.

### Where this goes next

- **A data flywheel.** Every time the agent gets something wrong in real use,
  that turn becomes a case in `golden.json`. The suite grows with usage, and the
  bugs you have already fixed cannot come back.
- **Braintrust.** `npm run eval` runs the same dataset and the same scorers
  through `evals/diagram.eval.ts`, which stores every run as an experiment
  tagged with your git branch. The local runner tells you the number; Braintrust
  tells you which case regressed between two numbers.
- **Human approval.** `addElements` currently draws the moment the model asks.
  Gating destructive calls behind a confirmation is Week 5's subject, and this
  is a good codebase to practise it in — `removeElements` on a diagram someone
  spent an hour on is exactly the call you want a human to see first.

---

## Things that will bite you

- **`convertToExcalidrawElements` only binds within its own batch.** Arrows to
  shapes from an earlier call float unless you patch them — and the back-
  reference in `boundElements` matters as much as the binding itself, or the
  arrow attaches but does not follow when the box moves.
- **Excalidraw stores a shape's label as a separate text element** with a
  `containerId`. Any code that reads the scene has to fold those in, or the
  model sees phantom duplicates and starts tidying them up.
- **Strict mode has no optional fields.** Use `.nullable()`, and strip the nulls
  before anything touches Excalidraw — it wants `undefined` for "default" and
  throws on `label: null`.
- **Strict mode also has no `oneOf`.** `z.discriminatedUnion` produces one and is
  rejected; `z.union` produces `anyOf` and is fine.
- **A harness that rebuilds your tools will drift from them.** Spread the
  production definition and add only the executor. Dropping one flag — `strict`,
  in our case — is enough for the suite to pass while production 400s on every
  request.
- **`onToolCall` captures its closure once.** Read the Excalidraw API from a ref,
  not from state, or you will hold the `null` from first render forever.
- **`stopWhen` does not bound a turn that uses client tools.** Every tool result
  is a new request with a new step counter. Bound the turn in the Durable
  Object, and take the tools away when the budget is spent.
- **Never offer a tool that cannot work.** An unconfigured tool that returns an
  error on every call is an invitation to retry it forever.
- **Write tool errors that say "stop".** "Search failed" reads as transient;
  "do not retry, draw from what you know and say so" ends the attempt.
- **Re-run the suite when you change model.** `gpt-4o-mini` scores 95% here
  against `gpt-5.4-mini`'s 99% — close enough to use, different enough that a
  four-point "improvement" measured across a model swap means nothing.
- **Evals are not free but they are cheap.** A full pass here is about a cent.
  A suite you avoid running because of the bill is a suite that does not exist.

---

## Exercises

1. **Break a scorer on purpose.** Make `boundArrows` return 1 unconditionally and
   re-run. Everything still passes, and the agent is still broken. Now you know
   what a green suite is worth.
2. **Find the ceiling.** Add three cases hard enough that the final agent scores
   under 80% on them. That is your next baseline.
3. **Three runs.** Run the suite three times without changing anything and record
   the spread per scorer. That number is your noise floor — improvements smaller
   than it are not improvements.
4. **Delete the layout grid** from the system prompt and re-run. Which scorer
   moves? Does the aggregate?
5. **A cheaper judge.** Replace the LLM judge on `create` cases with
   deterministic checks, and see how much of its signal you can recover for free.
6. **The flywheel, by hand.** Use the app until it does something wrong. Turn
   that exact turn into a case in `golden.json`, watch it fail, then fix it.

---

## Milestone

- [ ] The agent draws, modifies and deletes elements on a live canvas
- [ ] Four tools are fulfilled in the browser; two run on the Worker
- [ ] `npm run eval:local` runs the whole suite headlessly
- [ ] At least eight scorers, of which at most one is an LLM judge
- [ ] A dataset with modify cases that start from a seeded canvas, and one case
      where drawing is the wrong answer
- [ ] A recorded baseline, and a final run you can put beside it
- [ ] You can name one change that moved the number and one that did not
