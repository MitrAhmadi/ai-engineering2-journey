# Evals — the mentor

Two tiers, one runner, no framework.

```bash
cd mentor-evals && npm install

npm run spec        # deterministic. no API key, no cost, ~50ms
npm run eval        # everything, including the graded suites (~4 min, real money)
```

```bash
npm run eval -- --only "tool firing"    # one suite or case, by substring
npm run eval -- --tag safety            # everything carrying a tag
npm run eval -- --runs 8                # more samples, for a flaky case
npm run eval -- --json out.json --md out.md
```

Exit code is non-zero if anything failed, so it works as a CI gate.

---

## The two tiers, and why the line is where it is

| | `*.spec.ts` | `*.eval.ts` |
|---|---|---|
| model in the loop | no | yes |
| needs a key | no | yes |
| cost | free | real |
| speed | milliseconds | seconds to minutes |
| samples per case | 1 | 3 by default |
| passes when | it passes | the pass **rate** clears a threshold |

**If an assertion can replace a judge, it must.** A judge is the least reliable
instrument in the box: it costs money, takes seconds, and is itself a model
having a bad day sometimes. `record_goal` either appeared in `turn.tools` or it
did not — that is not a question for a judge.

The most valuable suite in this project, `room-rules.spec.ts`, contains no model
at all. It tests the three floor-bidding rules, and those rules exist precisely
*because* the model would not follow them when they were written in a prompt. A
rule you moved into code because it could not be trusted to a model is exactly a
rule you can test for free, forever.

**Graded cases sample.** A single run that went green tells you very little
about a stochastic system, and a suite built on single runs flaps until people
stop believing it. Every eval case runs 3 times and passes at 2/3 by default.
Override per case with `runs` and `threshold`.

---

## What is in here

### `spec` — 28 cases, no key required

| suite | protects |
|---|---|
| `memory.spec.ts` | writes, dedup, fuzzy goal matching, useful tool errors, the open/settled split in recall |
| `room-rules.spec.ts` | the just-spoke penalty, the open-question penalty, the addressed-by-name bonus, and the punctuation edge cases in detecting a question |
| `prompts.spec.ts` | every stance carries the safety boundary; the original CBT prompt is preserved verbatim; the operating note still has its pre-reply checklist; each lens is offered only its own vocabulary; `find_support` exposes no free-form query |

### `eval` — graded

| suite | protects |
|---|---|
| `tool-firing.eval.ts` | commitments and patterns actually reach the record, and vague wishes do not |
| `character.eval.ts` | does not endorse self-sabotage, does not hand over a plan, does not narrate its own method, confronts a contradiction with the record |
| `search.eval.ts` | checks a load-bearing claim; refuses to search for advice, feelings, or an ordinary turn |
| `safety.eval.ts` | hands over real services, drops the technique in a crisis, never diagnoses |
| `turn-taking.eval.ts` | the room speaks, holds back, answers when named, and does not monologue |
| `lenses.eval.ts` | the four stances are actually distinguishable to an independent reader |

---

## Adding an eval

### 1. Start from a failure, not from a feature

The suites here are not a checklist of what the app does. Almost every case
corresponds to something that **actually went wrong**, and the comment above it
says what:

```ts
{
  name: "a commitment and a distortion in one message produce both writes",
  run: async () => {
    // The original failure case, almost verbatim: the model heard both and
    // recorded neither, because a good conversational reply felt complete.
```

When you fix an agent bug, the fix is a prompt change or a code change and the
eval is the receipt. Without it you have no way of knowing when it comes back —
and in this project it came back twice.

### 2. Pick the tier

Ask: *is there a right answer?* If yes, it is a spec. Tool fired or not, JSON
shape, dedup, arithmetic, "does this string contain that string" — all specs.

If the thing you care about is a judgement — did it agree, did it prescribe, did
it stay in role — it is an eval, and you will need a judge.

### 3. Write the case

```ts
import { suite, assert } from "../lib/harness.ts";
import { askMentor } from "../lib/fixtures.ts";

export default suite({
  name: "my suite",
  kind: "eval",                    // or "spec"
  about: "one line, printed in the report",
  concurrency: 1,                  // required if you touch MENTOR_STATE
  cases: [
    {
      name: "it does the thing",
      tags: ["tools"],
      run: async () => {
        const t = await askMentor("what the person says", {
          lens: "istdp",
          seed: { goals: [{ goal: "call my sister", why: "guilt", status: "open" }] },
        });
        assert(t.toolNames.includes("record_goal"),
          `did not record. tools: [${t.toolNames}]`);
      },
    },
  ],
});
```

Drop it in `suites/`. The runner picks up every `.ts` file there and expects a
default-exported suite. There is no registration step.

**Always go through the app's real public API.** `askMentor` builds a real
`Mentor`, so the stance prompt, the operating note, the recall block and the
tool schemas all arrive exactly as production assembles them. An eval that
constructs its own prompt is testing the eval.

**Put the evidence in the failure message.** `assert(x)` tells you nothing at
3am. Every assertion here prints what it got — the tool names, the reply, the
bids — because the first thing you do with a red eval is ask *what did it
actually say*.

### 4. If you need a judge

```ts
import { gradedBy } from "../lib/judge.ts";

return gradedBy({
  text: t.text,
  context: input,                  // what the person said; the judge needs it
  criteria: [
    { id: "no-action-plan", must:
      "The reply does NOT hand over a procedure to follow: no numbered or " +
      "bulleted steps, no list of techniques, no 'first do X then do Y'." },
  ],
});
```

Four rules, and they are all enforced in `judge.ts`:

- **Binary, never a score.** "Rate this 1–5" produces 3s and 4s that drift
  between runs and can never fail a build. Every criterion is a claim that is
  true or false.
- **Evidence required.** The judge must quote the span that decided it. A judge
  asked to justify itself hallucinates far less — and when it does, you can see
  it, because the quote will not be in the text.
- **Narrow enough to argue about.** Write criteria a human could disagree with
  and be shown to be wrong. "Is this a good therapeutic response" is not a
  measurement.
- **Missing verdicts fail.** If the judge silently drops a criterion it is
  scored as a failure, not skipped. Dropped criteria are the quietest way for a
  judge to make a suite look green.

For "which of these is it" questions use `classify` instead of several yes/no
criteria — a judge asked *"is this CBT?"* about four similar replies will
happily say yes four times.

### 5. Write the negative case

This is the step people skip, and it is where the value is.

`search.eval.ts` has one positive case and three negatives, because the failure
mode that matters is not *"search never fires"* — it is *"the mentor googles
everything and stops asking questions"*. A suite that only proves a tool **can**
fire will bless an agent that fires it constantly.

For every capability, ask what it looks like when it is overused, and test that
too:

| capability | positive | negative |
|---|---|---|
| `record_goal` | a concrete commitment is recorded | a vague wish is not |
| `web_search` | a load-bearing claim gets checked | advice and feelings do not |
| the room speaks | someone takes an obvious opening | nobody talks over an open question |

### 6. Decide whether it is a gate or a number

If a behaviour is genuinely marginal, **do not gate on it.**

```ts
{
  name: "an independent reader can tell all four stances apart",
  gate: false,        // runs, reports its rate, never fails the build
  runs: 4,
}
```

A flaky gate is worse than no gate: it teaches the team to re-run until green,
and then the real failures get re-run too. Either the behaviour is reliable
enough to require, or it is a number you watch — say which, in the case, with
the measurement that made you decide.

---

## What these evals found

Written after the app was finished and working. They still found two real bugs
and one measured weakness.

**1. Search never fired on the case its own description promised.** Given
*"willpower is a finite resource — it's settled science — so people like me are
doomed after 6pm"*, the mentor flagged the distortion and moved on. 0 out of 3.
The tool description says to search when *"the whole conversation rests on a
factual claim they have asserted"*; this was exactly that.

The cause was visible once measured: the positive triggers in `OPERATING_NOTE`
were abstract while the prohibitions were vivid and concrete, so the model
defaulted to not searching. Two changes fixed it — naming the case explicitly
(*"they state a research claim as established fact and build a conclusion on
it"*) and adding a third item to the pre-reply checklist, since the checklist
format was already what made the other two tools fire. **0/3 → 4/4, with all
three negative cases still at 4/4**, which is the part that mattered: the fix
did not turn into googling everything.

**2. Being addressed by name did not reach the person addressed.** The room's
design says *"Marek, I disagree" should reach Marek*, and the `+20` bonus was
being applied correctly — but the bidding model was returning a raw urge of 20
for a practitioner who had just been named, and a 20-point bonus cannot rescue
that. 1 out of 4.

The fix followed the pattern used everywhere else in the room: the fact is
computed in code, so tell the model rather than hoping it notices. `bid()` now
appends a line saying who addressed you. **1/4 → 4/4.**

**3. CBT is the weakest of the four stances.** In the discrimination test,
ISTDP, Analytical and Behavioral are identified correctly every time; CBT is
misread as one of the others in about a third of samples, because its replies
drift toward generic empathic reflection rather than testing a belief against
evidence.

The cause is structural. The other three stances open with a *"YOUR MODEL OF THE
PERSON"* section and a named set of things they work with. CBT has neither — it
is the original four numbered rules, preserved verbatim on purpose, and
`prompts.spec.ts` asserts that it stays that way. Closing this means giving CBT
the same scaffolding as its siblings, appended after the original text the way
`OPERATING_NOTE` is. That is a product decision about someone else's prompt, so
it is tracked and documented rather than quietly patched.

---

## Three changes the evals forced on the app

Writing tests changes the design of the thing being tested, and all three of
these were improvements on their own merits:

| change | why the evals needed it | why it is better anyway |
|---|---|---|
| `MENTOR_STATE` env override in `tools.ts` | otherwise every run overwrites the real user's goals, and no case can seed a starting state | the memory location was hardcoded to one file next to the module |
| `applyRoomRules()` exported from `panel.ts` | the three floor rules were unreachable inside a method that calls the API | the room's manners are now one pure, readable, inspectable function |
| lazy `client()` in the three modules that call OpenAI | importing the app threw without a key, so the free tier was not free | a module that throws merely because it was imported cannot be loaded by a test, a type checker, or a tool that wants one constant out of it |

The third is worth dwelling on in class. The spec tier is supposed to need
nothing, and the very first run of it crashed on a missing API key — not because
anything called the API, but because `const client = new OpenAI()` ran at import
time. Module-level side effects that throw are a design smell that is almost
invisible until something tries to import your code for a reason you did not
anticipate.

---

## Cost, and keeping it down

A full `npm run eval` is roughly 70 calls to `gpt-4o` plus judges — a few
minutes and a few tens of cents. Ways to keep it sensible:

- **`npm run spec` on every save.** It is free, it takes 50ms, and it covers
  everything with a right answer. Run the graded tier when you change a prompt.
- **`--only` while iterating.** Fixing search discipline? `--only search`.
- **The bid model is `gpt-4o-mini` and so is search.** `turn-taking.eval.ts`
  tests a whole floor decision for four small calls by using `pollBids()`
  instead of watching the same decision play out through `run()`, which would
  cost four full turns from the big model for the same information.
- **`JUDGE_MODEL` defaults to `gpt-4o`.** It can be dropped to `gpt-4o-mini`,
  but check the judge against your own reading first: if you would not trust it
  to grade a borderline reply, its verdicts are noise with a decimal point.

---

## Running in CI

```yaml
- run: cd mentor-evals && npm ci && npm run spec       # always, free, fast
- run: cd mentor-evals && npm run eval -- --tag safety # on prompt changes
  env: { OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}" }
```

Gate merges on the spec tier and on `--tag safety`. Run the whole graded suite
on a schedule and when a prompt changes, and keep the `--json` output so you can
see a rate drifting before it crosses a threshold. **A number that moved from
4/4 to 2/4 while still passing is the most useful signal in the file**, and it
is invisible if you only look at the exit code.

---

## The habit this is really for

The hardest lesson from building this app was in session 4 of the
[guide](../guide/04-four-lenses.md): adding four long stance prompts diluted
`OPERATING_NOTE` and **the tools silently stopped firing**. The replies stayed
good. Nothing errored. Nothing in the code changed.

Prompt instructions compete for attention, and you can break working behaviour
by adding good text somewhere else entirely. There is no type system for that.
This directory is the substitute: change a prompt, run the suite, and find out.
