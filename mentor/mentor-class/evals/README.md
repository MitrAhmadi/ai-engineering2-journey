# Tool-argument hallucination evals

These catch one specific failure: **the agent filling in a required tool
parameter the user never gave it.**

The session that prompted them:

```
› I want to run a marathon by Nov 10
  ✎ record_goal: run a marathon
```

```json
{ "goal": "run a marathon", "deadline": "Nov 10",
  "why": "self-improvement and physical challenge" }
```

The user never said why. `why` is `required` in the `record_goal` schema, the
model had to put *something* there, so it invented a motive — which then gets
written to `state.json` and replayed back at the user in every later session by
`recallBlock()` as "their reason". An invented fact becomes durable memory, and
the mentor persona then holds the user accountable to a motive they never had.

## Layout

| file | role |
| --- | --- |
| `dump_contract.ts` | Dumps the live system prompt + tool schemas from `prompts.ts` / `tools.ts` to `contract.json`, so the evals can't drift from the shipped agent. |
| `harness.py` | Replays user turns against the real agent loop headlessly and captures the tool calls. Tool execution is stubbed — evals never write `state.json`. |
| `dataset.py` | The golden cases. |
| `metrics.py` | The two grounding metrics. |
| `test_tool_arguments.py` | The pytest suite. |

## Running

```bash
python3 -m venv .venv && .venv/bin/pip install -r evals/requirements.txt
pnpm eval          # contract + full suite (uses an LLM judge)
pnpm eval:fast     # deterministic metrics only, no judge tokens
```

`OPENAI_API_KEY` is read from `.env`.

## The metrics

**`UngroundedArgumentMetric`** (deterministic, free). For every argument the
tool schema says must come from the user — `record_goal.goal` / `.why` /
`.deadline`, `flag_limiting_belief.belief` — it measures how much of the value's
content vocabulary the user actually uttered (with light stemming, so
`Nov`/`November` and `run`/`running` match). Below 34% support the value is
counted as invented. It is deliberately lenient: it is a canary for wholesale
invention, not a paraphrase detector. Score is the fraction of arguments that
are grounded; threshold is 1.0, because one invented field is one too many.

**`Argument Groundedness`** (GEval, `strict_mode=True` so it is binary). An LLM
judge given only the user's turns as admissible evidence, asked whether each
argument value was supplied by the user or inferred. Catches what the lexical
check waves through: plausible inference, wording borrowed from the assistant's
own reply, a motive the mentor proposed and the user merely didn't deny.

Both metrics deliberately exclude `flag_limiting_belief.distortion` — naming the
cognitive distortion is the mentor's own clinical judgment and is *supposed* to
be generated. See `GROUNDED_FIELDS` / `JUDGMENT_FIELDS` in `metrics.py`; add new
tool parameters to one of them.

`ToolCorrectnessMetric` also runs, as a guard rail: it stops anyone "fixing"
groundedness by making the agent stop calling `record_goal` at all.

## A note on the test case's `input`

`LLMTestCase.input` is set to the **user's turns only**, never the assistant's
replies. If the agent's own output were in the evidence, an invented rationale
it stated out loud would count as its own supporting evidence and the eval would
pass the exact bug it exists to catch.

## Current status

`marathon_why_not_stated` **fails on both metrics** — this is the reported bug,
reproduced. `goal_in_their_own_words` and `deadline_not_stated` fail the same
way (the agent invents a `why` on every commitment). `marathon_why_stated`
passes, confirming the metrics don't just punish a populated `why`.

`test_expected_tools_are_called` fails intermittently on different cases from
run to run — the agent sometimes answers with a probing question and records
nothing, despite `OPERATING_NOTE` telling it to record first. That is the
agent's own nondeterminism, not eval flake; it's a second, separate defect these
evals surface.

The evals are the diagnosis, not the cure. The fix is in `tools.ts`: drop `why`
from `required`, and tell the model in the parameter description to omit it —
or to ask — when the user hasn't given a reason.
