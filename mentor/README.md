# The mentor

An uncompromising CBT-style accountability partner, and a room of four
practitioners who disagree with each other about why you are stuck.

Built across sessions 1–9 of the course. Everything here runs on Node with one
SDK and no framework.

```
mentor-agent/     the agent core and the two terminal interfaces
mentor-gui/       the browser, importing those cores unmodified
mentor-evals/     the eval suite — 28 specs, 26 graded cases
guide/            the build-along course: empty folder → finished app
mentor-class/     the earlier, simpler version built live in class
```

## Run it

```bash
cd mentor-agent && npm install
cp .env.example .env          # add your OPENAI_API_KEY
npm run dev                   # the 1:1 mentor
npm run panel                 # four practitioners in one room

cd ../mentor-gui && npm run gui        # both, in a browser, on :3488
cd ../mentor-evals && npm run spec     # 28 deterministic checks, no key needed
```

## What is interesting about it

**Memory is the feature.** "Hold the user accountable to previous commitments"
is not a prompting problem — a model with no memory meets a stranger every
session. Goals and beliefs live in `state.json` and are injected back into the
system prompt on every run. That file *is* the accountability.

**One core, three interfaces.** `mentor.ts` and `panel.ts` contain no
`console.log`, no `readline` and no DOM. The terminal, the web server and the
React app are three sinks for the same handlers.

**Turn-taking is the hard part of a multi-agent conversation.** Round-robin is a
script. Instead, after every turn each practitioner privately bids for the
floor, in parallel, and if nobody clears the bar the room goes quiet and waits
for you. Silence being an available move is what makes speaking mean something.

**Use the model for judgement, use code for rules.** Three floor rules — do not
monologue, do not talk over an unanswered question, answer when named — were
written in the bidding prompt first and ignored every time. They live in code
now, and `mentor-evals/suites/room-rules.spec.ts` tests them for free.

## Start here

[`guide/README.md`](guide/README.md) builds the whole thing from an empty folder
in eight sessions, with every code listing spliced from the working source
(`node guide/sync.mjs --check` fails if they drift).

[`mentor-evals/README.md`](mentor-evals/README.md) covers how to add evals, and
the two real bugs the suite found in code that already looked finished.
