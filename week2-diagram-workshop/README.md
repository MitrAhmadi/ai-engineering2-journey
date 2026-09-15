# Week 2 — The Diagram Agent, Measured

**Ship:** a diagram-design agent on a live Excalidraw canvas, an eval suite that
can see when it is wrong, and a measured improvement from **75% to 99%**.

Week 1 made an agent. This week makes an agent you can prove things about.

> You never ship an improvement you haven't measured. That single habit is the
> profession.

## Two ways to use this

- **Build it:** `BUILD.md` starts from an empty folder — ten parts, each one
  runnable, with the finished code beside it as the answer key.
- **Read the code:** `app/` is the finished product. `app/steps/` holds the
  earlier versions of the files that change shape during the week.

## Setup

```bash
cd app
npm install
cp .dev.vars.example .dev.vars     # add your OPENAI_API_KEY
npm run dev                        # → http://localhost:5173
npm run eval:local                 # the whole suite, ~1 cent, no account needed
```

Only `OPENAI_API_KEY` is required. Tavily (web search), Upstash Vector (RAG) and
Braintrust (the eval dashboard) each have a free tier and each unlock one part.

## The ten parts

| | adds | the point |
|---|---|---|
| 0 | the folder, Vite + Cloudflare | three runtimes in one repo |
| 1 | Worker, Durable Object, canvas, chat | an agent with no hands |
| 2 | the naive tool | it draws, and it looks fine |
| 3 | headless canvas, dataset, 3 scorers | **91%** — and the number is a lie |
| 4 | the scorers that see real failures | **75%** — the same agent, honestly graded |
| 5 | labels and bindings in the schema | **99%** — what a tool schema buys |
| 6 | `queryCanvas` + the serialiser | the agent can look before it edits |
| 7 | overlap feedback + the layout grid | the part where the number doesn't move |
| 8 | web search | facts on demand |
| 9 | RAG over your own corpus | the domain case finally passes |
| 10 | ship | what moved, what didn't, and what is now blind |

## What is interesting about it

**Four of the six tools have no `execute`.** The canvas lives in the browser, so
the tools that touch it are fulfilled by the browser through `onToolCall`. The
Worker streams the call out and waits. That is the shape of every agent that
manipulates something its server cannot see.

**The eval brings its own canvas.** `runAgent` swaps in executors backed by a
plain array, so the whole agent — same prompt, same tools, same step limit — runs
headlessly and the scorers grade the scene that would have been drawn, not the
model's description of it.

**The interesting result is the one that didn't move.** Part 5's schema change
bought 24 points. Part 7's long, careful system prompt bought zero on the
aggregate — it fixed exactly the thing it aimed at, and every other scorer was
already at the ceiling. The per-scorer breakdown is how you can tell those apart,
and the reason the workshop insists on one.

## The recorded runs

`app/evals/results/` holds the four runs the guide quotes, with per-case detail.
Read `app/evals/results/README.md` for what each one shows.

## The docs are generated

`BUILD.md` is produced from `BUILD.tmpl.md`, with all 48 code listings spliced
out of `app/` and `app/steps/`. `sync.mjs` also writes the banner above each
listing — the file path in *your* project, whether it is new or a replacement,
and the line range in the finished file — so neither the code nor the
instructions can drift:

```bash
node sync.mjs             # regenerate BUILD.md
node sync.mjs --check     # exit 1 if it is stale
```

Edit `BUILD.tmpl.md` for prose and `app/` for code — never `BUILD.md`.

## Credit

The destination is Scott Moss's **ai-engineering-fundamentals** — the Cloudflare
Agents + Excalidraw diagram tool, its lesson notes, and the branch-per-lesson
layout. This workshop is an independent build-up to the same architecture on the
same stack, written to be taught in one week: the code here is our own, the
design it arrives at is his. Read his lesson notes alongside it; where the two
differ, his is the reference implementation.
