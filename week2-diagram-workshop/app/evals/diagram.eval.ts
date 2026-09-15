// The same dataset and the same scorers, wired into Braintrust.
//
// Why bother, when evals/run.ts already prints the numbers? Because the number
// is not the point — the DIFF is. Braintrust stores every run as an experiment
// tagged with your git branch and commit, so "did that prompt change help?"
// becomes a side-by-side of two runs with the regressed cases highlighted,
// instead of two terminal scrollbacks and your memory.
//
//   npm run eval          (needs BRAINTRUST_API_KEY in .dev.vars)
//   npm run eval:local    (needs nothing but an OpenAI key)
import { readFileSync } from "node:fs";
import { Eval } from "braintrust";
import { createOpenAI } from "@ai-sdk/openai";
import { runAgent } from "../src/agent-core";
import type { AgentOutput, GoldenCase, Scorer } from "./types";
import { schema } from "./scorers/schema";
import { structure } from "./scorers/structure";
import { boundArrows } from "./scorers/bound-arrows";
import { boundLabels } from "./scorers/bound-labels";
import { noOverlaps } from "./scorers/no-overlaps";
import { toolChoice } from "./scorers/tool-choice";
import { labels } from "./scorers/labels";
import { preserved } from "./scorers/preserved";
import { restraint } from "./scorers/restraint";
import { makeJudge } from "./scorers/judge";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const cases: GoldenCase[] = JSON.parse(readFileSync("evals/datasets/golden.json", "utf8"));

// Our scorers take { case, output }; Braintrust hands over { input, output }.
// One adapter keeps the scorers portable between the two runners.
const adapt = (scorer: Scorer) => async ({ input, output }: { input: GoldenCase; output: AgentOutput }) => {
  const { name, score, note } = await scorer({ case: input, output });
  return { name, score, metadata: { note } };
};

Eval("Diagram Agent", {
  data: () =>
    cases.map((testCase) => ({
      input: testCase,
      expected: testCase,
      metadata: { id: testCase.id, category: testCase.category, difficulty: testCase.difficulty },
    })),

  task: async (testCase: GoldenCase): Promise<AgentOutput> => {
    const result = await runAgent({
      model: openai.chat(process.env.EVAL_MODEL ?? "gpt-5.4-mini"),
      messages: [{ role: "user", content: testCase.input }],
      seedCanvas: testCase.seed ?? [],
      env: {
        TAVILY_API_KEY: process.env.TAVILY_API_KEY,
        UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL,
        UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN,
      },
    });
    return { text: result.text, elements: result.elements, toolCalls: result.toolCalls };
  },

  scores: [
    schema, structure, toolChoice, boundArrows, boundLabels,
    noOverlaps, labels, preserved, restraint,
    makeJudge(process.env.OPENAI_API_KEY),
  ].map(adapt),
});
