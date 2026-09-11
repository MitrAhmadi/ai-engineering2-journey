# Building the mentor: a room of psychologists that disagree with you

A build-along course. You start with an empty folder and finish with two
working applications sharing one agent core:

- **a 1:1 mentor** — an uncompromising CBT-style accountability partner that
  remembers what you promised last week and holds you to it;
- **the room** — four practitioners from four traditions in one conversation
  with you, deciding for themselves who speaks next, and interruptible
  mid-sentence.

Along the way you build the things that actually make agents work in production:
streaming, tool calling, persistent memory, cancellation, a core cleanly split
from its interfaces, live web search with sources, server-sent events, and
multi-agent turn-taking.

## What you end up with

```
mentor-agent/          the agent core and the terminal interfaces
  modalities.ts          four therapeutic stances
  tools.ts               memory on disk + five tools
  search.ts              the one place a fact enters from outside
  mentor.ts              the 1:1 core       (no console.log, no DOM)
  panel.ts               the multi-agent core (no console.log, no DOM)
  agent.ts               terminal interface for the 1:1 mentor
  panel-cli.ts           terminal interface for the room
  state.json             the memory. this file IS the accountability

mentor-gui/            the browser, importing the cores UNMODIFIED
  server/server.ts       HTTP + server-sent events
  client/src/            React: Solo, Room, Avatar, ToolReceipt, RichText
```

## The eight sessions

| # | session | what is new | you can run it |
|---|---|---|---|
| 1 | [The loop that streams](01-the-loop.md) | messages array, streaming, readline | a conversation in your terminal |
| 2 | [Memory and tools](02-memory-and-tools.md) | tool calling, `state.json`, the operating note | it writes down what you promise |
| 3 | [Interruption and the core](03-interruption-and-the-core.md) | `AbortController`, core/interface split | Ctrl+C stops the *answer*, not the app |
| 4 | [Four lenses](04-four-lenses.md) | four stances, switching mid-conversation | the same story read four ways |
| 5 | [Reaching outside](05-web-search.md) | hosted web search, settling commitments | it checks claims and cites sources |
| 6 | [The browser](06-the-browser.md) | SSE, React, the core imported unchanged | the same agent, in a tab |
| 7 | [The room](07-the-room.md) | multi-agent turn-taking by bidding | four practitioners arguing |
| 8 | [The room in the browser](08-the-room-in-the-browser.md) | EventSource, avatars, the bid strip | the finished app |
| 9 | [Evals](../mentor-evals/README.md) | two tiers, judges, negative cases | a suite that catches the next regression |

Sessions 1–5 are the agent. 6 is the interface. 7–8 are the multi-agent system.
If you only have time for half of it, stop after 5: that is a complete,
genuinely useful agent, and every idea after it is an extension rather than a
correction.

## Before you start

You need **Node 20 or newer** (`node --version`), an **OpenAI API key**, and a
terminal. No database, no Docker, no framework. TypeScript runs directly
through `tsx`, so there is no build step for the agent — you edit a file and
run it.

Everything is deliberately built on `fetch`, the standard library and one SDK.
When something breaks you will be able to see why, which is not true of most
agent frameworks.

## How to teach this

Every session ends in something that runs. Resist the urge to skip ahead to the
finished file: about a third of the code in this project exists because of a
specific failure that showed up when it was *not* there, and those failures are
the actual lesson. They are called out in the text like this:

> **What went wrong.** The model was told "dynamically invoke tools to record
> new goals". It heard a hard commitment and a textbook distortion in one
> sentence and recorded neither.

When you hit one of those in class, run the broken version first. It is far
more convincing than being told.

Then read [`mentor-evals/`](../mentor-evals/README.md), which is the same idea turned into
something automatic. Every one of those failures is a case in there now — and
writing them found two more that nobody had noticed.

The code listings in this guide are spliced from the working source by
`node guide/sync.mjs`; `--check` fails if they have drifted.

## A note on what this is not

This app is not therapy and does not pretend to be. Every stance carries an
explicit boundary — not a licensed therapist, never diagnose, and when the
conversation goes somewhere clinical, drop the technique and hand over a real
number. Session 5 builds the tool that makes that boundary actionable rather
than decorative. It is worth discussing with students as a design question, not
a legal footnote: an agent that adopts a role has to know where the role ends.
