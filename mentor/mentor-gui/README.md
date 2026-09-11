# mentor-gui

A browser interface for the mentor agent in `../mentor-agent/`.

    npm install
    npm run gui        # builds the client, then serves on http://127.0.0.1:3488

`npm run start` alone skips the build and serves whatever is already in
`client/dist`. During UI work, run `npm run start` in one terminal and
`cd client && npm run dev` in another — Vite proxies `/api` to port 3488.

## The point of this folder

`server/server.ts` imports `mentor.ts` and `tools.ts` from `mentor-agent/`
**without modifying them**. The terminal REPL and this GUI are two interfaces
over one agent: same system prompt, same tool definitions, same `state.json`.

A goal you commit to in the terminal shows up in the browser sidebar, and the
mentor holds you to it in either place. If that works, the split between the
agent core and its interface is real.

## What the UI adds over the CLI

The right-hand panel makes the agent's memory visible: every goal and every
flagged limiting belief, with the deadline and the reason you gave. New entries
flash as they are written, mid-conversation — you watch a commitment become a
record.

"New conversation" clears the chat but **not** the memory. You don't get to
escape a commitment by refreshing the page.

## The room

The second tab (`/#room`) runs a different thing on the same core: four
practitioners in one conversation with you, sharing a single transcript and a
single `state.json`.

    cd ../mentor-agent && npm run panel     # the same room, in the terminal

**Nobody takes turns in order.** After every turn each practitioner privately
scores how badly they want to speak next, 0–100, all four at once against a
small model (`BID_MODEL`, default `gpt-4o-mini`). The strongest claim takes the
floor. If nobody clears the bar, the room goes quiet and waits for you. Silence
being an available move is what makes speaking mean something — and the bid
strip above the composer shows you every score, including the ones that decided
to stay out of it.

Three rules are enforced in code rather than left to the model, because the
model reliably got them wrong on its own:

| rule | why |
|---|---|
| the previous speaker is penalised 40 | otherwise one voice monologues |
| an unanswered question to you costs 35 | four clinicians will otherwise stack four questions and never let you answer |
| being named by the last speaker earns 20 | "Marek, I disagree" should reach Marek |

**You are never queued.** The composer is never disabled. Press enter three
words into someone's sentence and they are cut off there — the fragment stays
in the transcript, marked, exactly as an interruption works in a real room, and
everyone re-bids against what you just said.

Each practitioner writes to the shared record in their own vocabulary only
(`toolsFor()` in `tools.ts` narrows the tool description per lens), so an entry
logged as `complex` came from Sylvia and one logged as `negative reinforcement
of avoidance` came from Theo. Identical entries are deduplicated — four people
hearing one promise is not four promises.

Env: `PANEL=istdp,behavioral npm run panel` picks who is in the room.

## Tools

Five, and both interfaces show every call as it happens — watching the write is
the point.

| tool | what it does |
|---|---|
| `record_goal` | a commitment becomes a row in `state.json` |
| `update_goal` | settles one already there: **kept**, **missed**, **dropped**, with what actually happened |
| `flag_limiting_belief` | names a pattern, in the lens's own vocabulary |
| `web_search` | checks a fact against the live web, and returns its sources |
| `find_support` | real services, real numbers, for when this stops being the right room |

`update_goal` is what makes the record a record rather than a pile. Before it,
commitments only ever accumulated and nothing was ever settled — the mentor
could hold you to a promise but never learn that you kept it.

`web_search` runs on the Responses API's hosted search (`search.ts`), so there
is no second API key. The interesting part of it is the prompt, not the plumbing:
a Socratic mentor that reaches for a search engine mid-session is usually
avoiding the harder move, so the tool is fenced to facts it would otherwise
invent — a protocol, a figure, a claim the whole conversation is resting on —
and explicitly forbidden as a substitute for the next question. Sources are
rendered as links in both the browser and the terminal; an unsourced claim is
the thing search was added to avoid.

`find_support` is not a general search: the query is built in code so a model in
the middle of a difficult moment cannot turn it into something else. In the room
it also **ends the round** — once someone has handed over a real number, three
colleagues agreeing that therapy is important is the room talking to itself.
