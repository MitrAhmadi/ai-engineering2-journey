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

{{SLICE:app/package.json:  "scripts":::  "dependencies"|note:replace the generated "scripts" block}}

{{FILE:app/vite.config.ts}}

{{FILE:app/wrangler.jsonc}}

Only the first key is needed to start; the rest unlock one part each.

{{FILE:app/.dev.vars.example|as:.dev.vars|note:new file — never commit it}}

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

{{FILE:app/src/worker.ts}}

### The agent

{{FILE:app/steps/part1/agent.ts|as:src/agent.ts|note:new file}}

### The core

{{FILE:app/steps/part1/agent-core.ts|as:src/agent-core.ts|note:new file}}

### The canvas

{{FILE:app/src/components/Canvas.tsx}}

`excalidrawAPI` is the whole interface between your agent and the drawing:
`getSceneElements()` to read, `updateScene()` to write. Everything in the rest of
this workshop goes through those two calls.

### The chat panel

{{FILE:app/src/components/Chat.tsx}}

### Wiring them together

{{FILE:app/steps/part1/App.tsx|as:src/App.tsx|note:new file}}

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

{{FILE:app/steps/part2/tools.ts|as:src/tools.ts|note:new file}}

{{FILE:app/steps/part2/system-prompt.ts|as:src/system-prompt.ts|note:new file}}

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

{{FILE:app/steps/part2/App.tsx|as:src/App.tsx|note:REPLACES the Part 1 version}}

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

{{SLICE:app/src/agent-core.ts:/**
 * Headless run, for evals.:::/**
 * Adapter for an older tool surface|note:ADD below streamAgent}}

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

{{FILE:app/evals/types.ts}}

A case looks like this — a `create` one, then a `modify` one that starts with
elements already on the canvas:

{{SLICE:app/evals/datasets/golden.json:  {
    "id": "create-02-three-chain":::  {
    "id": "create-03-flowchart"|note:2 of the 14 cases — copy the whole file from app/}}

Three things to notice about the dataset, because they are what makes it useful
rather than decorative:

- **The modify cases carry a `seed`.** The canvas is not empty when the turn
  starts, which is the only way to test "change the thing that is already there".
- **`expectCounts` and `expectLabels` are checkable by code.** Anything a
  computer can check, a computer should check.
- **There is a case where the right answer is to draw nothing** (`edge-02`).
  Every eval suite drifts towards rewarding action. Keep a case that punishes it.

### The first three scorers

{{FILE:app/evals/scorers/schema.ts}}

{{FILE:app/evals/scorers/structure.ts}}

{{FILE:app/evals/scorers/tool-choice.ts}}

### The runner

{{FILE:app/evals/run.ts|note:new file — you will add scorers to it in Part 4}}

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

{{FILE:app/evals/scorers/bound-arrows.ts}}

{{FILE:app/evals/scorers/bound-labels.ts}}

{{FILE:app/src/canvas/overlaps.ts}}

{{FILE:app/evals/scorers/no-overlaps.ts}}

Three more, each short enough to read in one breath. `labels.ts` checks the nouns
from the request made it onto the canvas:

{{FILE:app/evals/scorers/labels.ts}}

`preserved.ts` checks a modify turn did not destroy what it was not asked to
touch:

{{FILE:app/evals/scorers/preserved.ts}}

And `restraint.ts` checks the agent kept its hands still on the one case where
drawing is the wrong answer:

{{FILE:app/evals/scorers/restraint.ts}}

Two of those needed a way to describe the canvas in words. So does the judge
below, so write it now — Part 6 is where we argue about why it looks like this.

{{FILE:app/src/canvas/serialize.ts}}

### And one that is not deterministic

{{FILE:app/evals/scorers/judge.ts}}

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

{{FILE:app/src/tools/element-schema.ts}}

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

{{FILE:app/src/tools/add-elements.ts}}

{{FILE:app/src/tools/update-elements.ts}}

The other two follow the same pattern — a description the model can act on, a
tiny schema, and no `execute`:

{{FILE:app/src/tools/remove-elements.ts}}

{{FILE:app/src/tools/query-canvas.ts}}

Then the registry. This file replaces the flat `src/tools.ts` from Part 2; delete
that one, and update the import in `src/agent-core.ts` from `"./tools"` (the
file) to `"./tools"` (the folder) — the specifier does not change, but make sure
the old file is gone or it will win:

{{FILE:app/src/tools/index.ts|note:new file — replaces src/tools.ts from Part 2}}

### The browser side, properly this time

Excalidraw ships a helper, `convertToExcalidrawElements`, that turns exactly this
compact shape into a real scene — labels bound, arrows bound, defaults filled.
All that hand-written boilerplate from Part 2 goes away.

One thing the helper does not do: resolve a binding to a shape that is already on
the canvas from an earlier call. That is its own file, because the symptom
(arrows that attach on the first diagram and float on the second) is baffling
until someone tells you.

{{FILE:app/src/canvas/bindings.ts}}

{{FILE:app/src/App.tsx|note:REPLACES the Part 2 version}}

### The eval needs the same expansion

The headless canvas has no Excalidraw, so it would score the model's raw claims
instead of what the canvas would actually render — "I set a label" would pass
even when nothing rendered.

{{FILE:app/src/canvas/skeleton.ts}}

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

{{FILE:app/src/system-prompt.ts|note:REPLACES the Part 2 prompt}}

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

{{FILE:app/src/tools/search-web.ts}}

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

{{SLICE:app/src/tools/index.ts:/**
 * A tool that cannot work should not be offered.:::  return tools as {|note:REPLACES the buildTools from Part 5}}

**2. The prompt advertised tools that were not there.** The system prompt names
six tools, so the model announced lookups it had no way to perform. One
canonical prompt plus a line of errata per deployment:

{{SLICE:app/src/agent-core.ts:/**
 * The system prompt names six tools.:::export const MAX_STEPS|note:ADD above MAX_STEPS}}

**3. There was no bound on the turn.** This is the important one, and it is the
`stopWhen` trap from Part 2 arriving. The bound has to live where the state
lives — in the Durable Object, across requests:

{{SLICE:app/src/agent.ts:/**
 * How many model calls one user message may cost.:::export class DesignAgent|note:ADD above the class}}

…and then, when the budget is gone, take the tools away for the rest of the turn:

{{SLICE:app/src/agent.ts:  async onChatMessage():::|note:REPLACES the Part 1 body}}

Those two new arguments — `toolChoice` and `extraSystem` — have to reach
`streamText`, so `streamAgent` grows a little:

{{SLICE:app/src/agent-core.ts:/** Live chat. Tool calls stream to the browser; the browser draws. */:::/**
 * Headless run, for evals.|note:REPLACES the Part 1 version}}

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

{{SLICE:app/corpus/deployment-pipeline.md:# Deployment pipeline:::8. **Rollback**|note:your own reference doc — this one is an example}}

{{FILE:app/src/rag/vector-store.ts}}

{{FILE:app/src/rag/embed.ts}}

{{FILE:app/src/tools/search-knowledge.ts}}

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
