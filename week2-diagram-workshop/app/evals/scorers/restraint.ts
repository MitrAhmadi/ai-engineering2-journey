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
