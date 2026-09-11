// tool-firing.eval.ts — does the agent actually write things down?
//
// This is the single most important graded suite, because this exact behaviour
// broke twice during the build and both times it was invisible: the replies
// stayed good, the record just quietly stopped filling up.
//
//   1. Rule 4 said "dynamically invoke tools" and the model recorded nothing.
//   2. Adding four long stance prompts diluted OPERATING_NOTE and it stopped
//      again — caused by adding good text somewhere else entirely.
//
// The grading is deterministic — a tool either fired or it did not — even
// though the thing being graded is stochastic. That is the ideal shape for an
// eval: sample a model, assert on a fact. Never ask a judge something you can
// check.
import { suite, assert } from "../lib/harness.ts";
import { askMentor } from "../lib/fixtures.ts";

export default suite({
  name: "tool firing",
  kind: "eval",
  about: "commitments and patterns reach the record",
  concurrency: 1,                 // seeds MENTOR_STATE, which is process-global
  cases: [
    {
      name: "a concrete commitment is recorded",
      tags: ["tools"],
      run: async () => {
        const t = await askMentor(
          "Right, I'm doing it. I'm going to the gym three times a week starting Monday, " +
          "because I'm sick of feeling out of breath on the stairs.");
        assert(t.toolNames.includes("record_goal"),
          `record_goal did not fire. tools: [${t.toolNames}]\n      reply: ${t.text.slice(0, 200)}`);
        const goal = t.tools.find((x) => x.name === "record_goal")!;
        assert(/gym/i.test(String(goal.args.goal)), `goal text lost the commitment: ${goal.args.goal}`);
      },
    },
    {
      name: "a deadline the person named is captured verbatim",
      tags: ["tools"],
      run: async () => {
        const t = await askMentor(
          "I'll send my supervisor the full chapter by Friday. I promised her weeks ago.");
        const goal = t.tools.find((x) => x.name === "record_goal");
        assert(goal, `record_goal did not fire. tools: [${t.toolNames}]`);
        assert(/friday/i.test(String(goal!.args.deadline ?? "") + String(goal!.args.goal)),
          `the deadline was dropped: ${JSON.stringify(goal!.args)}`);
      },
    },
    {
      name: "a textbook distortion is flagged",
      tags: ["tools"],
      run: async () => {
        const t = await askMentor(
          "My supervisor didn't reply to my email. She's obviously decided I'm a waste of her time.");
        assert(t.toolNames.includes("flag_limiting_belief"),
          `flag_limiting_belief did not fire. tools: [${t.toolNames}]\n      reply: ${t.text.slice(0, 200)}`);
      },
    },
    {
      name: "a commitment and a distortion in one message produce both writes",
      tags: ["tools"],
      run: async () => {
        // The original failure case, almost verbatim: the model heard both and
        // recorded neither, because a good conversational reply felt complete.
        const t = await askMentor(
          "I'm going to write every morning at 6am starting Monday, because I never finish " +
          "anything. I'm probably just not the kind of person who finishes things.");
        assert(t.toolNames.includes("record_goal"), `no record_goal. tools: [${t.toolNames}]`);
        assert(t.toolNames.includes("flag_limiting_belief"), `no flag. tools: [${t.toolNames}]`);
      },
    },
    {
      name: "a vague wish is NOT recorded as a commitment",
      tags: ["tools", "negative"],
      run: async () => {
        // A record full of daydreams cannot hold anyone to anything. The tool
        // description says "not for vague wishes" and this is what defends it.
        const t = await askMentor(
          "I dunno, it'd be nice to be fitter at some point. Maybe. One of these days.");
        assert(!t.toolNames.includes("record_goal"),
          `recorded a daydream as a commitment: ${JSON.stringify(t.tools.map((x) => x.args))}`);
      },
    },
    {
      name: "reporting back settles the open commitment",
      tags: ["tools", "memory"],
      run: async () => {
        const t = await askMentor("I actually did it — I ran three times last week.", {
          seed: { goals: [{ goal: "run three times a week", why: "I feel sluggish", status: "open" }] },
        });
        const upd = t.tools.find((x) => x.name === "update_goal");
        assert(upd, `update_goal did not fire. tools: [${t.toolNames}]\n      reply: ${t.text.slice(0, 200)}`);
        assert(upd!.args.status === "kept", `settled with the wrong status: ${upd!.args.status}`);
      },
    },
    {
      name: "a missed commitment is settled as missed, not re-recorded",
      tags: ["tools", "memory", "negative"],
      run: async () => {
        const t = await askMentor(
          "The chapter didn't happen. I know I said Friday. I'll try again this week.", {
          seed: { goals: [{ goal: "send my supervisor the full chapter",
                            why: "I promised her", deadline: "by Friday", status: "open" }] },
        });
        const upd = t.tools.find((x) => x.name === "update_goal");
        assert(upd, `update_goal did not fire. tools: [${t.toolNames}]`);
        assert(["missed", "dropped"].includes(String(upd!.args.status)),
          `a missed deadline settled as: ${upd!.args.status}`);
      },
    },
  ],
});
