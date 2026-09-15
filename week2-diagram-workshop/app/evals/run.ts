// The local eval runner. No account, no dashboard, no network beyond the model
// call itself — just the dataset, the scorers, and a table.
//
// Run it:
//   npm run eval:local                 the whole suite
//   npm run eval:local -- --case modify    only cases whose id contains "modify"
//   npm run eval:local -- --no-judge       skip the LLM judge (free and instant)
//
// Braintrust (evals/diagram.eval.ts) does more: it stores every run, diffs
// experiments, and shows you which case regressed. Use it for the improvement
// loop. Use this one while you are writing scorers, because a scorer you are
// still debugging should not cost a round trip to anyone's servers.
import { readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { runAgent } from "../src/agent-core";
import type { AgentOutput, GoldenCase, Score, Scorer } from "./types";
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

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const useJudge = !args.includes("--no-judge");

// Run the suite against a different system prompt without editing the agent:
//   EVAL_SYSTEM_FILE=steps/part3/system-prompt.ts npm run eval:local
// That is how Part 6 compares the prompt it just wrote against the one it
// replaced, on the same dataset, in the same run conditions.
const systemFile = process.env.EVAL_SYSTEM_FILE;
const system = systemFile
  ? ((await import(`${process.cwd()}/${systemFile}`)) as { SYSTEM_PROMPT: string }).SYSTEM_PROMPT
  : undefined;

// Same idea for the tool surface:
//   EVAL_TOOLS_FILE=steps/part2/tools.ts npm run eval:local
const toolsFile = process.env.EVAL_TOOLS_FILE;
const tools = toolsFile
  ? ((await import(`${process.cwd()}/${toolsFile}`)) as { buildTools: () => Record<string, unknown> }).buildTools()
  : undefined;

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set — put it in .dev.vars");

const openai = createOpenAI({ apiKey });
// A small model for the agent under test. Evals are meant to be run often; if
// a full pass costs a dollar you will stop running it, and an eval you do not
// run is worth nothing.
const model = openai.chat(process.env.EVAL_MODEL ?? "gpt-5.4-mini");

const cases: GoldenCase[] = JSON.parse(readFileSync("evals/datasets/golden.json", "utf8"));
const selected = only ? cases.filter((c) => c.id.includes(only)) : cases;

const scorers: Scorer[] = [
  schema,
  structure,
  toolChoice,
  boundArrows,
  boundLabels,
  noOverlaps,
  labels,
  preserved,
  restraint,
  ...(useJudge ? [makeJudge(apiKey)] : []),
];

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);

const totals = new Map<string, { sum: number; n: number }>();
const rows: { id: string; scores: Score[]; ms: number }[] = [];

for (const testCase of selected) {
  const started = Date.now();
  let output: AgentOutput;
  try {
    const result = await runAgent({
      model,
      system,
      tools,
      messages: [{ role: "user", content: testCase.input }],
      seedCanvas: testCase.seed ?? [],
      env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY,
             UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL,
             UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN },
    });
    output = { text: result.text, elements: result.elements, toolCalls: result.toolCalls };
  } catch (err) {
    // A crashed run is a zero, not a crashed suite. You want the other
    // nineteen numbers even when one case blows up.
    console.log(`  ✘ ${testCase.id} — agent threw: ${(err as Error).message}`);
    output = { text: "", elements: [], toolCalls: [] };
  }

  const scores: Score[] = [];
  for (const scorer of scorers) {
    const score = await scorer({ case: testCase, output });
    scores.push(score);
    if (score.score === null) continue;
    const t = totals.get(score.name) ?? { sum: 0, n: 0 };
    t.sum += score.score;
    t.n += 1;
    totals.set(score.name, t);
  }

  rows.push({ id: testCase.id, scores, ms: Date.now() - started });

  const summary = scores
    .filter((s) => s.score !== null)
    .map((s) => `${s.name} ${pct(s.score!)}`)
    .join("  ");
  console.log(`  ${pad(testCase.id, 26)} ${summary}`);
  for (const s of scores) {
    if (s.score !== null && s.score < 1 && s.note) console.log(`      ${pad(s.name, 12)} ${s.note}`);
  }
}

console.log("\n  ── averages ──");
let overall = 0;
for (const [name, { sum, n }] of [...totals].sort()) {
  console.log(`  ${pad(name, 14)} ${pct(sum / n)}   (${n} case${n === 1 ? "" : "s"})`);
  overall += sum / n;
}
const mean = overall / totals.size;
console.log(`\n  overall ${pct(mean)} across ${rows.length} cases\n`);

// Write the run to disk so you can diff two runs by hand. Braintrust does this
// properly; this is the version you can read in a text editor.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  `evals/results/${stamp}.json`,
  JSON.stringify(
    {
      model: process.env.EVAL_MODEL ?? "gpt-5.4-mini",
      system: systemFile ?? "src/system-prompt.ts",
      tools: toolsFile ?? "src/tools/index.ts",
      mean,
      rows,
    },
    null,
    2
  )
);
console.log(`  saved evals/results/${stamp}.json\n`);
