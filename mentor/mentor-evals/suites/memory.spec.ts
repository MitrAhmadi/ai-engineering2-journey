// memory.spec.ts — the record on disk.
//
// Nothing here calls a model. Every one of these has a right answer, so a judge
// would be both slower and less trustworthy than an assertion.
import { suite, assert, assertEq } from "../lib/harness.ts";
import { withState, currentState } from "../lib/fixtures.ts";
import { runTool, recallBlock } from "../../mentor-agent/tools.ts";

const call = (name: string, args: Record<string, unknown>, lens?: any) =>
  runTool(name, args as any, lens);

const parse = async (name: string, args: Record<string, unknown>, lens?: any) =>
  JSON.parse((await call(name, args, lens)).content);

export default suite({
  name: "memory",
  kind: "spec",
  about: "state.json: writes, dedup, settling, recall",
  concurrency: 1,           // MENTOR_STATE is process-global
  cases: [
    {
      name: "record_goal writes a goal with its lens and open status",
      tags: ["tools"],
      run: () => withState({}, async () => {
        const res = await parse("record_goal",
          { goal: "run three times a week", why: "I feel sluggish", deadline: "from Monday" }, "cbt");
        assert(res.ok, "expected ok");
        const { goals } = currentState();
        assertEq(goals.length, 1, "one goal written");
        assertEq(goals[0].goal, "run three times a week", "goal text stored verbatim");
        assertEq(goals[0].deadline, "from Monday", "deadline stored verbatim");
        assertEq(goals[0].status, "open", "a new goal starts open");
        assertEq(goals[0].modality, "cbt", "the writing lens is stamped on the record");
      }),
    },
    {
      name: "the same commitment is not recorded twice",
      tags: ["tools", "panel"],
      run: () => withState({}, async () => {
        // Four practitioners hearing one promise is not four promises.
        await call("record_goal", { goal: "Call my sister", why: "guilt" }, "cbt");
        const second = await parse("record_goal",
          { goal: "call my sister.", why: "guilt" }, "istdp");   // case + punctuation differ
        assert(second.alreadyRecorded, "the second write should report it is already there");
        assertEq(currentState().goals.length, 1, "still one goal");
      }),
    },
    {
      name: "a dedup response tells the model what to do instead",
      tags: ["tools", "recovery"],
      run: () => withState({}, async () => {
        await call("record_goal", { goal: "meditate daily", why: "stress" }, "cbt");
        const second = await parse("record_goal", { goal: "meditate daily", why: "stress" }, "theo" as any);
        // A tool result is a message to a reader that can act on it. Silence
        // makes the model retry or invent; a note redirects it.
        assert(typeof second.note === "string" && second.note.length > 0,
          "expected a note steering the model to say something instead");
      }),
    },
    {
      name: "two lenses may name the same belief differently",
      tags: ["tools", "panel"],
      run: () => withState({}, async () => {
        const belief = "I'm just lazy";
        await call("flag_limiting_belief", { belief, distortion: "labeling" }, "cbt");
        await call("flag_limiting_belief", { belief, distortion: "self-attack" }, "istdp");
        assertEq(currentState().beliefs.length, 2,
          "the same belief under two traditions is two observations, not a duplicate");
      }),
    },
    {
      name: "one lens naming it the same way twice is a duplicate",
      tags: ["tools", "panel"],
      run: () => withState({}, async () => {
        const b = { belief: "I'm just lazy", distortion: "labeling" };
        await call("flag_limiting_belief", b, "cbt");
        const again = await parse("flag_limiting_belief", b, "cbt");
        assert(again.alreadyFlagged, "expected alreadyFlagged");
        assertEq(currentState().beliefs.length, 1, "still one belief");
      }),
    },
    {
      name: "update_goal settles a commitment it can only partly quote",
      tags: ["tools"],
      run: () => withState({ goals: [{ goal: "run three times a week", why: "sluggish" }] }, async () => {
        // The model quotes goals from memory, not byte for byte.
        const res = await parse("update_goal",
          { goal: "run three times", status: "kept", what_happened: "I went Mon, Wed and Sat" });
        assert(res.ok, `expected a match, got ${JSON.stringify(res)}`);
        const g = currentState().goals[0];
        assertEq(g.status, "kept", "status settled");
        assertEq(g.outcome, "I went Mon, Wed and Sat", "outcome in their words");
        assert(!!g.updatedAt, "updatedAt stamped");
      }),
    },
    {
      name: "update_goal on an unknown commitment fails usefully",
      tags: ["tools", "recovery", "negative"],
      run: () => withState({ goals: [{ goal: "write every morning", why: "unfinished thesis" }] }, async () => {
        const res = await parse("update_goal",
          { goal: "quit smoking", status: "missed", what_happened: "still smoking" });
        assertEq(res.ok, false, "should not invent a match");
        assert(Array.isArray(res.openGoals) && res.openGoals.includes("write every morning"),
          "the error must hand back the list it should have chosen from");
        assert(String(res.note).includes("record_goal"),
          "and tell it the right tool for a genuinely new commitment");
        assertEq(currentState().goals[0].status, "open", "nothing was settled");
      }),
    },
    {
      name: "recall separates outstanding commitments from settled ones",
      tags: ["memory"],
      run: () => withState({
        goals: [
          { goal: "write every morning", why: "thesis", status: "open" },
          { goal: "call my sister", why: "guilt", status: "missed", outcome: "I kept putting it off" },
        ],
      }, async () => {
        const block = recallBlock();
        assert(block.includes("still outstanding"), "outstanding section present");
        assert(block.includes("already settled"), "settled section present");
        assert(block.includes("MISSED"), "a missed commitment is named as missed");
        assert(block.includes("I kept putting it off"), "what happened is carried into the prompt");
        // This is the whole point: a missed commitment must reach the model.
        const settledAt = block.indexOf("already settled");
        assert(block.indexOf("call my sister") > settledAt, "the missed goal sits under settled");
      }),
    },
    {
      name: "recall on an empty record says it is a first session",
      tags: ["memory"],
      run: () => withState({}, async () => {
        assert(recallBlock().includes("first session"),
          "an empty record must not read as a person with no goals");
      }),
    },
    {
      name: "an unknown tool name is an error, not a crash",
      tags: ["tools", "negative"],
      run: () => withState({}, async () => {
        const res = await parse("delete_everything", {});
        assertEq(res.ok, false, "unknown tools are refused");
      }),
    },
  ],
});
