import { findOverlaps } from "../../src/canvas/overlaps";
import type { Scorer } from "../types";

// Is the layout readable?
//
// The same findOverlaps the agent gets in its tool results — which is the
// point. One definition of "clean layout" steers the agent at run time and
// grades it at eval time, so the thing you optimise and the thing you measure
// cannot drift apart.
//
// Graded rather than binary: one collision in a twelve-box architecture
// diagram is a blemish, and six is a pile. A binary score hides the difference
// and makes the improvement loop feel flat when it is actually working.
export const noOverlaps: Scorer = ({ output }) => {
  const shapes = (output.elements as { type?: string; containerId?: string | null }[]).filter(
    (el) => !el.containerId && el.type !== "arrow" && el.type !== "line"
  );
  const pairs = (shapes.length * (shapes.length - 1)) / 2;
  if (pairs === 0) return { name: "noOverlaps", score: null };

  const hits = findOverlaps(output.elements);
  return {
    name: "noOverlaps",
    score: Math.max(0, 1 - hits.length / pairs),
    note: hits.length ? `${hits.length} overlapping pair(s): ${hits.slice(0, 3).map((p) => p.join("+")).join(", ")}` : "clean",
  };
};
