import type { Scorer } from "../types";

// Does the diagram say the words the user asked for?
//
// Cheap, literal, and surprisingly effective: if someone asks for a login flow
// with a User, an Auth Server and a Database, those three words should appear
// on the canvas. It cannot tell you the diagram is *good* — but a diagram
// missing the nouns from the request is definitely wrong, and this catches it
// for free.
export const labels: Scorer = ({ case: testCase, output }) => {
  const wanted = testCase.expectLabels;
  if (!wanted?.length) return { name: "labels", score: null };

  const text = (output.elements as { text?: string; label?: { text?: string } }[])
    .map((el) => `${el.text ?? ""} ${el.label?.text ?? ""}`)
    .join(" ")
    .toLowerCase();

  const found = wanted.filter((word) => text.includes(word.toLowerCase()));
  return {
    name: "labels",
    score: found.length / wanted.length,
    note: found.length === wanted.length ? "all present" : `missing: ${wanted.filter((w) => !found.includes(w)).join(", ")}`,
  };
};
