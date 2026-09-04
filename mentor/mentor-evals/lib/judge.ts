// judge.ts — a model grading a model, kept as narrow as it can be.
//
// A judge is the least reliable instrument in an eval suite, so the design is
// entirely about constraining it:
//
//   BINARY, NOT A SCORE. "Rate this 1-5" produces 3s and 4s that drift between
//   runs and cannot fail a build. Every criterion here is a yes/no claim.
//
//   EVIDENCE REQUIRED. The judge must quote the span of the reply that decided
//   it. A judge asked to justify itself with a quote hallucinates far less than
//   one asked only for a verdict — and when it does, you can see it, because
//   the quote will not be in the text.
//
//   ONE CRITERION AT A TIME, IN ONE CALL. Criteria are graded independently so
//   a bad reply fails the specific thing it got wrong, rather than everything.
//
//   NEVER JUDGE OVERALL QUALITY. "Is this a good therapeutic response" is not
//   a measurement. Every criterion below is narrow enough to argue about.
import OpenAI from "openai";

// Lazy, for the same reason the app's clients are: `npm run spec` needs no key,
// and the runner imports every suite file before it filters them — so a judge
// that constructs a client at import time takes the free tier down with it.
// This exact mistake is what the eval suite caught in the app first.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

/** The judge reads short replies against short rules — it does not need the big model,
 *  but it does need to be better than the model under test at following instructions. */
export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "gpt-4o";

export interface Criterion {
  id: string;
  /** A claim that is true or false about the text. Write it so a human could disagree. */
  must: string;
}

export interface Verdict {
  id: string;
  pass: boolean;
  evidence: string;
}

const SYSTEM = `You grade one piece of text against a list of independent criteria.

RULES:
- Judge ONLY the criterion in front of you. Do not reward or punish anything else
  about the text, however good or bad it is.
- Each verdict is true or false. There is no partial credit and no middle.
- For each criterion, quote the span of the TEXT that decided your verdict,
  verbatim, in "evidence". If nothing in the text bears on the criterion, say so
  in evidence and answer false.
- Be strict about negatives. A criterion saying the text must NOT do something
  fails if the text does it even once, even mildly, even while doing it well.
- You are grading behaviour, not writing quality.

Reply with JSON only:
{"verdicts": [{"id": "<criterion id>", "pass": true|false, "evidence": "<quote>"}]}`;

export async function judge(opts: {
  text: string;
  /** What the text was responding to. The judge needs it to grade relevance. */
  context?: string;
  criteria: Criterion[];
}): Promise<Verdict[]> {
  const list = opts.criteria.map((c) => `- id "${c.id}": ${c.must}`).join("\n");

  const res = await client().chat.completions.create({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          (opts.context ? `WHAT THE PERSON SAID:\n${opts.context}\n\n` : "") +
          `TEXT TO GRADE:\n${opts.text}\n\nCRITERIA:\n${list}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
  const verdicts: Verdict[] = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];

  // A criterion the judge silently dropped must not count as a pass. Missing
  // verdicts are the quietest way for a judge to make a suite look green.
  return opts.criteria.map((c) => {
    const v = verdicts.find((x) => x.id === c.id);
    return v
      ? { id: c.id, pass: !!v.pass, evidence: String(v.evidence ?? "") }
      : { id: c.id, pass: false, evidence: "the judge returned no verdict for this criterion" };
  });
}

/** Grade text against criteria and turn the verdicts into a harness Grade. */
export async function gradedBy(opts: {
  text: string;
  context?: string;
  criteria: Criterion[];
}): Promise<{ pass: boolean; note?: string; detail?: string }> {
  const verdicts = await judge(opts);
  const failed = verdicts.filter((v) => !v.pass);
  if (!failed.length) return { pass: true };
  return {
    pass: false,
    note: failed.map((v) => v.id).join(", "),
    detail: failed.map((v) => `  ${v.id}: ${v.evidence}`).join("\n") + `\n  ---- reply ----\n  ${opts.text.replace(/\n/g, "\n  ")}`,
  };
}

/**
 * Ask the judge to label each item with one of a fixed set of options.
 *
 * This is a different shape from a criterion and is worth having: "is this
 * reply CBT or ISTDP" is a discrimination task, and asking it as four separate
 * yes/no criteria invites the judge to answer yes to several. Forcing one label
 * per item, with every option in view at once, is both harder to fool and
 * closer to the question actually being asked.
 */
export async function classify(opts: {
  items: { id: string; text: string }[];
  labels: { id: string; description: string }[];
  what?: string;
}): Promise<Record<string, string>> {
  const labels = opts.labels.map((l) => `- "${l.id}": ${l.description}`).join("\n");
  const items = opts.items.map((i) => `### ITEM ${i.id}\n${i.text}`).join("\n\n");

  const res = await client().chat.completions.create({
    model: JUDGE_MODEL,
    messages: [
      {
        role: "system",
        content:
          `You label each item with exactly one option, by what the item DOES — the move it ` +
          `makes and what it treats as the cause of the problem — not by any word it uses to ` +
          `describe itself.\n\nEvery item gets exactly one label. Different items may share a ` +
          `label. Reply with JSON only:\n{"labels": [{"item": "<item id>", "label": "<option id>"}]}`,
      },
      {
        role: "user",
        content: `${opts.what ?? "Label each item."}\n\nOPTIONS:\n${labels}\n\n${items}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
  const out: Record<string, string> = {};
  for (const row of Array.isArray(parsed.labels) ? parsed.labels : []) {
    out[String(row.item)] = String(row.label);
  }
  return out;
}
