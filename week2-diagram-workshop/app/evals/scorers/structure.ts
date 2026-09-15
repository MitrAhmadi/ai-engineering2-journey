import type { Scorer } from "../types";

// Did it draw the right NUMBER of the right THINGS?
//
// "Draw three boxes connected by arrows" has a checkable answer: three
// rectangles, two arrows. The case declares that in `expectCounts` and this
// scorer compares. Partial credit, because two boxes out of three is genuinely
// better than zero and you want to see that difference when you tune.
//
// Note what it deliberately cannot see: whether the diagram makes sense. That
// is the judge's job. This one is arithmetic, and arithmetic is free.
export const structure: Scorer = ({ case: testCase, output }) => {
  const expected = testCase.expectCounts;
  if (!expected) return { name: "structure", score: null };

  const counts: Record<string, number> = {};
  for (const el of output.elements as { type?: string; containerId?: string }[]) {
    // A bound label is part of its shape, not an element in its own right.
    if (el.containerId) continue;
    if (el.type) counts[el.type] = (counts[el.type] ?? 0) + 1;
  }

  let earned = 0;
  const parts: string[] = [];
  for (const [type, want] of Object.entries(expected)) {
    const got = counts[type] ?? 0;
    earned += Math.min(got, want) / want;
    parts.push(`${type} ${got}/${want}`);
  }
  const score = earned / Object.keys(expected).length;
  return { name: "structure", score, note: parts.join(", ") };
};
