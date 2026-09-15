import type { Scorer } from "../types";

// Did it leave alone what it was not asked to touch?
//
// The failure this catches is the most annoying one a user can experience:
// they ask for one box to be recoloured and the agent helpfully redraws the
// whole diagram, throwing away every manual tweak they had made. The canvas
// looks fine in a screenshot. The person is furious.
export const preserved: Scorer = ({ case: testCase, output }) => {
  const ids = testCase.preserveIds;
  if (!ids?.length) return { name: "preserved", score: null };

  const present = new Set((output.elements as { id?: string }[]).map((el) => el.id));
  const kept = ids.filter((id) => present.has(id));
  return {
    name: "preserved",
    score: kept.length / ids.length,
    note: kept.length === ids.length ? "nothing lost" : `lost: ${ids.filter((id) => !present.has(id)).join(", ")}`,
  };
};
