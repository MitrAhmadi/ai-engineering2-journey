// run.ts — the eval runner.
//
//   npm run spec                 deterministic only. No API key, no cost.
//   npm run eval                 everything, including the graded suites.
//   npm run eval -- --only tool  one suite or case, by substring
//   npm run eval -- --tag safety run everything carrying a tag
//   npm run eval -- --runs 5     more samples per graded case
//
// Exits non-zero if anything failed, so it works as a CI gate.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool, runCase, type CaseResult, type Suite } from "./lib/harness.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[38;5;114m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
};

interface Args {
  specOnly: boolean;
  only?: string;
  tag?: string;
  runs?: number;
  json?: string;
  md?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { specOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--spec-only") a.specOnly = true;
    else if (v === "--only") a.only = argv[++i];
    else if (v === "--tag") a.tag = argv[++i];
    else if (v === "--runs") a.runs = Number(argv[++i]);
    else if (v === "--json") a.json = argv[++i];
    else if (v === "--md") a.md = argv[++i];
    else if (v === "--help" || v === "-h") { usage(); process.exit(0); }
    else { console.error(`unknown flag: ${v}`); usage(); process.exit(2); }
  }
  return a;
}

function usage(): void {
  console.log(`
  usage: tsx run.ts [--spec-only] [--only <substring>] [--tag <tag>]
                    [--runs <n>] [--json <file>] [--md <file>]
`);
}

async function loadSuites(): Promise<Suite[]> {
  const dir = path.join(HERE, "suites");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  const suites: Suite[] = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (!mod.default) throw new Error(`${f} has no default export`);
    suites.push(mod.default as Suite);
  }
  // Specs first: they are free and fast, and a broken spec usually explains a
  // graded failure you would otherwise spend money discovering.
  return suites.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "spec" ? -1 : 1));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = await loadSuites();

  const match = (s: Suite, name: string, tags: string[]): boolean => {
    if (args.specOnly && s.kind !== "spec") return false;
    if (args.tag && !tags.includes(args.tag)) return false;
    if (args.only) {
      const needle = args.only.toLowerCase();
      if (!s.name.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle)) return false;
    }
    return true;
  };

  const planned = all
    .map((s) => ({ suite: s, cases: s.cases.filter((cs) => match(s, cs.name, cs.tags ?? [])) }))
    .filter((p) => p.cases.length);

  if (!planned.length) {
    console.log(c.amber("\n  nothing matched\n"));
    process.exit(2);
  }

  const needsKey = planned.some((p) => p.suite.kind === "eval");
  if (needsKey && !process.env.OPENAI_API_KEY) {
    console.log(c.red("\n  graded suites need OPENAI_API_KEY."));
    console.log(c.dim("  run `npm run spec` for the deterministic tier, which needs nothing.\n"));
    process.exit(2);
  }

  console.log();
  console.log(`  ${c.bold(c.violet("mentor evals"))}  ${c.dim(
    `${planned.reduce((n, p) => n + p.cases.length, 0)} case(s) in ${planned.length} suite(s)`)}`);

  const results: CaseResult[] = [];
  const started = Date.now();

  for (const { suite, cases } of planned) {
    const badge = suite.kind === "spec" ? c.dim("[spec]") : c.amber("[eval]");
    console.log(`\n  ${badge} ${c.bold(suite.name)}  ${c.dim(suite.about)}`);

    if (args.runs && suite.kind === "eval") {
      for (const cs of cases) cs.runs = args.runs;
    }

    const got = await pool(cases, suite.concurrency ?? (suite.kind === "spec" ? 8 : 3),
      (cs) => runCase(suite, cs));

    for (const r of got) {
      results.push(r);
      const mark = r.tracked ? c.amber("○") : r.pass ? c.green("✓") : c.red("✗");
      const rate = r.runs > 1 ? c.dim(` ${r.passes}/${r.runs}`) : "";
      const time = c.dim(` ${r.ms}ms`);
      const tag = r.tracked ? c.amber("  tracked, not gated") : "";
      console.log(`    ${mark} ${r.name}${rate}${time}${tag}`);
      if (r.tracked) {
        for (const note of [...new Set(r.notes)].slice(0, 1)) {
          console.log(c.dim(`        ${note.replace(/\n/g, "\n        ")}`));
        }
      }
      if (!r.pass) {
        for (const note of [...new Set(r.notes)]) {
          console.log(c.red(`        ${note.replace(/\n/g, "\n        ")}`));
        }
        if (r.detail) console.log(c.dim(`      ${r.detail.replace(/\n/g, "\n      ")}`));
      }
    }
  }

  const failed = results.filter((r) => !r.pass);
  const specs = results.filter((r) => r.kind === "spec" && !r.tracked);
  const evals = results.filter((r) => r.kind === "eval" && !r.tracked);

  console.log();
  console.log(`  ${c.bold("summary")}  ${c.dim(`${((Date.now() - started) / 1000).toFixed(1)}s`)}`);
  const tracked = results.filter((r) => r.tracked);
  if (specs.length) console.log(`    spec  ${specs.filter((r) => r.pass).length}/${specs.length}`);
  if (evals.length) {
    const samples = evals.reduce((n, r) => n + r.runs, 0);
    const passed = evals.reduce((n, r) => n + r.passes, 0);
    console.log(`    eval  ${evals.filter((r) => r.pass).length}/${evals.length}` +
      c.dim(`   (${passed}/${samples} samples)`));
  }
  for (const t of tracked) {
    console.log(c.amber(`    tracked  ${t.name}: ${t.passes}/${t.runs}`));
  }
  console.log(failed.length ? c.red(`\n  ${failed.length} failing\n`) : c.green(`\n  all green\n`));

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    console.log(c.dim(`  wrote ${args.json}`));
  }
  if (args.md) {
    fs.writeFileSync(args.md, markdown(results));
    console.log(c.dim(`  wrote ${args.md}`));
  }

  process.exit(failed.length ? 1 : 0);
}

function markdown(results: CaseResult[]): string {
  const lines = [`# Eval run — ${new Date().toISOString()}`, ""];
  for (const kind of ["spec", "eval"] as const) {
    const rows = results.filter((r) => r.kind === kind);
    if (!rows.length) continue;
    lines.push(`## ${kind}`, "", "| suite | case | result |", "|---|---|---|");
    for (const r of rows) {
      lines.push(`| ${r.suite} | ${r.name} | ${r.pass ? "✅" : "❌"} ${r.runs > 1 ? `${r.passes}/${r.runs}` : ""} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
