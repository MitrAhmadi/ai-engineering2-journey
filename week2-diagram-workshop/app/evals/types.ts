// The shape of one test case, and of one scorer.
//
// Both runners — the local one and the Braintrust one — use these, so a scorer
// is written once and can be run with or without an account.

export type Category = "create" | "modify" | "domain" | "edge";
export type Difficulty = "simple" | "medium" | "hard";

export interface GoldenCase {
  id: string;
  /** What the user types. */
  input: string;
  category: Category;
  difficulty: Difficulty;
  /** Elements already on the canvas when the turn starts. Modify cases only. */
  seed?: unknown[];
  /** Plain-English facts about a good answer. Read by the judge scorer. */
  expect: string[];
  /** Counts a correct diagram must contain, e.g. { rectangle: 3, arrow: 2 }. */
  expectCounts?: Record<string, number>;
  /** Words that must appear in the labels, lowercased. */
  expectLabels?: string[];
  /** Ids that must still exist afterwards. Modify cases only. */
  preserveIds?: string[];
  /** True when the right answer is to draw nothing at all. */
  expectNoDraw?: boolean;
}

export interface AgentOutput {
  text: string;
  elements: unknown[];
  toolCalls: string[];
}

export interface Score {
  name: string;
  /** 0 to 1. null means "not applicable to this case" — the runner skips it. */
  score: number | null;
  note?: string;
}

export type Scorer = (args: {
  case: GoldenCase;
  output: AgentOutput;
}) => Score | Promise<Score>;
