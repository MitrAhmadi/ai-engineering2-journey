// harness.ts — the eval framework. About a hundred lines, no dependencies.
//
// TWO TIERS, and the distinction matters more than the code:
//
//   spec  deterministic. No API key, no network, runs in milliseconds. Use it
//         for anything with a right answer — dedup, path matching, the room's
//         scoring rules. If a judge could be replaced by an assertion, it
//         should be.
//
//   eval  a model is in the loop, so the result is a sample, not a fact. Every
//         case runs N times and passes on a RATE. A single run that went green
//         tells you almost nothing, and a suite built on single runs will flap
//         until people stop believing it.

export interface Grade {
  pass: boolean;
  /** One line shown next to the result. On failure, say what was wrong. */
  note?: string;
  /** Longer evidence — a quoted reply, a judge's reasoning — shown when failing. */
  detail?: string;
}

export interface Case {
  name: string;
  /** Free-form labels for --tag filtering: "safety", "tools", "negative"… */
  tags?: string[];
  /** Samples to draw. Ignored for specs, which are deterministic. */
  runs?: number;
  /** Fraction of samples that must pass. Default 1 for specs, 2/3 for evals. */
  threshold?: number;
  /**
   * `gate: false` runs the case and reports its pass RATE without ever failing
   * the build. Use it for a behaviour you want measured but have decided not to
   * gate on — typically one that is genuinely marginal, where any threshold you
   * pick will flap and teach the team to ignore red.
   *
   * A flaky gate is worse than no gate: it trains people to re-run until green.
   * Either the behaviour is reliable enough to require, or it is a number you
   * watch. Say which, out loud, in the case.
   *
   * This is NOT a place to park a test you intend to fix. A suite where this is
   * common is a suite nobody reads.
   */
  gate?: boolean;
  /**
   * Return nothing (or a Grade) to pass; throw to fail. Throwing is the normal
   * path for specs, where `assert` reads better than building a Grade.
   */
  run: (attempt: number) => Promise<Grade | void> | Grade | void;
}

export interface Suite {
  name: string;
  kind: "spec" | "eval";
  /** One line explaining what this suite protects. Printed in the report. */
  about: string;
  cases: Case[];
  /**
   * How many cases run at once. Anything that writes the shared state file, or
   * sets MENTOR_STATE, must stay at 1 — the environment is process-global and
   * concurrent cases would read each other's memory.
   */
  concurrency?: number;
}

export function suite(s: Suite): Suite {
  return s;
}

// ---- assertions -----------------------------------------------------------

export class AssertionError extends Error {}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}

export function assertEq<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(`${message}\n      expected: ${fmt(expected)}\n      actual:   ${fmt(actual)}`);
  }
}

export function assertIncludes(haystack: string, needle: string, message: string): void {
  if (!haystack.toLowerCase().includes(needle.toLowerCase())) {
    throw new AssertionError(`${message}\n      looked for: ${fmt(needle)}\n      in: ${fmt(haystack)}`);
  }
}

export function assertExcludes(haystack: string, needle: string, message: string): void {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    throw new AssertionError(`${message}\n      found: ${fmt(needle)}\n      in: ${fmt(haystack)}`);
  }
}

function fmt(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return (s ?? String(v)).length > 300 ? `${(s ?? "").slice(0, 300)}…` : (s ?? String(v));
}

// ---- results --------------------------------------------------------------

export interface CaseResult {
  suite: string;
  name: string;
  kind: "spec" | "eval";
  tags: string[];
  passes: number;
  runs: number;
  threshold: number;
  pass: boolean;
  /** Tracked but not gated: reported, never counted as a failure. */
  tracked: boolean;
  ms: number;
  /** Notes from every sample, so a 2/3 shows you which one failed and why. */
  notes: string[];
  detail?: string;
}

/** Run one case, sampling as many times as it asks for. */
export async function runCase(s: Suite, c: Case): Promise<CaseResult> {
  const runs = s.kind === "spec" ? 1 : (c.runs ?? 3);
  const threshold = c.threshold ?? (s.kind === "spec" ? 1 : 2 / 3);
  const started = Date.now();

  let passes = 0;
  const notes: string[] = [];
  let detail: string | undefined;

  for (let attempt = 0; attempt < runs; attempt++) {
    try {
      const grade = await c.run(attempt);
      if (grade && grade.pass === false) {
        notes.push(grade.note ?? "failed");
        if (grade.detail && !detail) detail = grade.detail;
      } else {
        passes++;
        if (grade?.note) notes.push(grade.note);
      }
    } catch (err) {
      const e = err as Error;
      notes.push(e instanceof AssertionError ? e.message : `${e.name}: ${e.message}`);
      if (!detail && !(e instanceof AssertionError)) detail = e.stack;
    }
  }

  const met = passes / runs >= threshold - 1e-9;
  const tracked = c.gate === false;

  return {
    suite: s.name, name: c.name, kind: s.kind, tags: c.tags ?? [],
    passes, runs, threshold,
    pass: tracked ? true : met,
    tracked,
    ms: Date.now() - started,
    notes, detail,
  };
}

/** Bounded-concurrency map. The API calls dominate, so this is worth having. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
