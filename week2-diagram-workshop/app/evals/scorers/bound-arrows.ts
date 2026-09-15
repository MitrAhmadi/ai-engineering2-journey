import type { Scorer } from "../types";

// Are the arrows actually attached to anything?
//
// This is the scorer that catches the prettiest kind of broken diagram. The
// model emits arrows with plausible coordinates that LOOK like connections in
// a screenshot, but have no binding — so the moment anyone drags a box, the
// arrows stay behind and the diagram falls apart in their hands.
//
// Fraction of arrows with both ends bound.
export const boundArrows: Scorer = ({ output }) => {
  const arrows = (output.elements as Record<string, unknown>[]).filter((el) => el.type === "arrow");
  if (arrows.length === 0) return { name: "boundArrows", score: null };

  const bound = arrows.filter((a) => a.startBinding && a.endBinding).length;
  return {
    name: "boundArrows",
    score: bound / arrows.length,
    note: `${bound}/${arrows.length} arrows bound at both ends`,
  };
};
