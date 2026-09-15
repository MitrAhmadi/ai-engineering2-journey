import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { serializeCanvasState } from "../../src/canvas/serialize";
import type { Scorer } from "../types";

// The one scorer that costs money, and the only one that can read meaning.
//
// Everything else in this folder is arithmetic: count the rectangles, check
// the bindings, measure the boxes. That covers most of what "broken" means for
// a diagram — and then it runs out. "Does this actually depict an OAuth
// authorization code flow?" is not a property you can compute.
//
// So: a model reads the canvas and checks the claims in `expect`. Three rules
// keep it honest, and they generalise to every LLM judge you will ever write:
//
//   1. Ask for a verdict per claim, never a vibe. "Score this diagram out of
//      ten" produces a number that means nothing and drifts between runs.
//   2. Make each claim binary. Yes or no, with the evidence quoted from the
//      canvas summary it was given.
//   3. Judge the artifact, not the agent's story about the artifact. We pass
//      the serialised canvas — the same summary the agent itself would read —
//      and not the chat reply, which is where a model will tell you it drew
//      something beautiful.
//
// Reach for this LAST. A deterministic scorer is free, instant, and identical
// every run; a judge is none of those. Use it only for what code cannot see.
const verdicts = z.object({
  results: z.array(
    z.object({
      claim: z.string(),
      holds: z.boolean(),
      evidence: z.string().describe("Quote the element ids or labels that decide it"),
    })
  ),
});

export function makeJudge(apiKey: string | undefined, model = "gpt-5.4-mini"): Scorer {
  return async ({ case: testCase, output }) => {
    if (!testCase.expect?.length) return { name: "judge", score: null };
    if (!apiKey) return { name: "judge", score: null, note: "no OPENAI_API_KEY" };

    const openai = createOpenAI({ apiKey });
    const canvas = serializeCanvasState(output.elements);

    const { object } = await generateObject({
      model: openai.chat(model),
      schema: verdicts,
      system:
        "You check whether a diagram satisfies a list of claims. You see a text " +
        "summary of the canvas: every element with its id, type, position, size and " +
        "label. Judge ONLY from that summary. For each claim answer true or false and " +
        "quote the ids or labels that decide it. Do not be generous: a claim that is " +
        "partly satisfied is false.",
      prompt: [
        `The user asked: ${testCase.input}`,
        "",
        "Canvas:",
        canvas,
        "",
        "Claims to check:",
        ...testCase.expect.map((claim, i) => `${i + 1}. ${claim}`),
      ].join("\n"),
    });

    const held = object.results.filter((r) => r.holds);
    const failed = object.results.filter((r) => !r.holds);
    return {
      name: "judge",
      score: object.results.length ? held.length / object.results.length : null,
      note: failed.length ? `failed: ${failed.map((f) => f.claim).join("; ")}` : "all claims hold",
    };
  };
}
