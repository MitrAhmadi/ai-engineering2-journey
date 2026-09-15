import type { Scorer } from "../types";

// Did it reach for the right tool, in the right order?
//
// This scorer never looks at the drawing. It looks at the sequence of tool
// names, which turns out to be where a lot of agent quality lives:
//
//   create → addElements must have been called. A chatty reply describing the
//            diagram it would draw is a failure, however well written.
//   modify → queryCanvas must come BEFORE the first mutation. An agent that
//            edits ids it guessed will be right often enough to fool a demo
//            and wrong often enough to lose someone's work.
//
// Partial credit for mutating without looking: the intent was right, the
// discipline was not.
// Tool names change as the design does. Part 2 draws with generateDiagram;
// from Part 5 on it is addElements. The scorer has to recognise both, or every
// comparison between the two designs measures the rename instead of the work.
const DRAW = ["addElements", "generateDiagram"];
const MUTATE = ["addElements", "updateElements", "removeElements", "generateDiagram", "modifyDiagram"];

export const toolChoice: Scorer = ({ case: testCase, output }) => {
  const calls = output.toolCalls ?? [];

  if (testCase.category === "create" || testCase.category === "domain") {
    const ok = calls.some((c) => DRAW.includes(c));
    return { name: "toolChoice", score: ok ? 1 : 0, note: ok ? "drew something" : `never called addElements (${calls.join(" → ") || "no tools"})` };
  }

  if (testCase.category === "modify") {
    const firstMutation = calls.findIndex((c) => MUTATE.includes(c));
    const queried = calls.indexOf("queryCanvas");
    if (firstMutation < 0) return { name: "toolChoice", score: 0, note: "nothing was changed" };
    if (queried < 0 || queried > firstMutation) {
      // Half marks, and the half that is missing is real: an agent editing ids
      // it never looked up is guessing. On the Part 2 tool surface it cannot
      // do better — there is no queryCanvas — which is precisely the argument
      // for adding one.
      return { name: "toolChoice", score: 0.5, note: "changed the canvas without reading it first" };
    }
    return { name: "toolChoice", score: 1, note: calls.join(" → ") };
  }

  return { name: "toolChoice", score: null };
};
