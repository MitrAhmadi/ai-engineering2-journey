import type { Scorer } from "../types";

// Does the output even qualify as a diagram?
//
// The bluntest scorer, and the one you write first: no elements at all, or
// elements missing the fields the canvas needs, means everything downstream is
// noise. Binary on purpose — half a valid element is not half a diagram.
const REQUIRED = ["id", "type", "x", "y", "width", "height"] as const;
const TYPES = ["rectangle", "ellipse", "diamond", "arrow", "line", "text"];

export const schema: Scorer = ({ case: testCase, output }) => {
  // A case whose correct answer is an empty canvas must not be marked down for
  // producing one. A scorer that punishes the right answer is worse than no
  // scorer: it teaches you to "fix" an agent that was already correct.
  if (testCase.expectNoDraw) return { name: "schema", score: null };

  if (!Array.isArray(output.elements) || output.elements.length === 0) {
    return { name: "schema", score: 0, note: "no elements produced" };
  }
  for (const el of output.elements as Record<string, unknown>[]) {
    for (const field of REQUIRED) {
      if (!(field in el)) return { name: "schema", score: 0, note: `${el.id} missing ${field}` };
    }
    if (typeof el.type !== "string" || !TYPES.includes(el.type)) {
      return { name: "schema", score: 0, note: `bad type: ${String(el.type)}` };
    }
  }
  return { name: "schema", score: 1, note: `${output.elements.length} elements` };
};
