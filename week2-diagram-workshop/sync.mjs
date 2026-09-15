#!/usr/bin/env node
// sync.mjs — splice real source into BUILD.md, and label every listing.
//
// BUILD.tmpl.md is the authored document. Every code listing in it is a
// placeholder naming a real file under app/ or app/steps/, so the guide cannot
// drift from the code that actually runs — and so the file path and line
// numbers printed above each listing cannot drift either. They are computed
// here, from the file, at generate time.
//
//   {{FILE:app/src/worker.ts}}                        whole file
//   {{FILE:app/steps/part2/tools.ts|as:src/tools.ts}} whole file, renamed for
//                                                     the student's project
//   {{SLICE:app/src/agent.ts:const TURN:::export class}}   marker → marker
//   …|note:replaces the version from Part 2}}         extra label text
//
// A placeholder stands ALONE on its line — no surrounding ``` fence. This
// script emits the banner, the fence and the language tag together:
//
//   **`src/worker.ts`** · new file · 19 lines
//
//   ```ts
//   …
//   ```
//
//   node sync.mjs            regenerate BUILD.md
//   node sync.mjs --check    exit 1 if BUILD.md is stale (use it in CI)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "BUILD.tmpl.md");
const OUT = path.join(HERE, "BUILD.md");

const LANGS = {
  ".ts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js",
  ".json": "json", ".jsonc": "jsonc", ".md": "md", ".css": "css", ".html": "html",
};

const read = (rel) => {
  const abs = path.join(HERE, rel);
  if (!fs.existsSync(abs)) throw new Error(`sync: no such file: ${rel}`);
  return fs.readFileSync(abs, "utf8").trimEnd();
};

/**
 * Where this file lives in the STUDENT's project, which is not always where it
 * lives here. `app/src/worker.ts` is their `src/worker.ts`; the snapshots under
 * `app/steps/partN/` are earlier versions of a file they keep in `src/`, so
 * those must say so explicitly with `|as:`.
 */
function studentPath(rel, as) {
  if (as) return as;
  if (rel.startsWith("app/steps/")) {
    throw new Error(`sync: ${rel} is a snapshot — it needs an |as:<path> so the guide can say where it goes`);
  }
  return rel.replace(/^app\//, "");
}

/** Line numbers of `text` within `full`, 1-based and inclusive. */
function lineRange(full, text) {
  const at = full.indexOf(text);
  const before = full.slice(0, at);
  const from = before.split("\n").length;
  return [from, from + text.split("\n").length - 1];
}

function block(rel, { as, note, body }) {
  const full = read(rel);
  const whole = body === undefined;
  const code = whole ? full : body;
  const lang = LANGS[path.extname(rel)] ?? "";
  const where = studentPath(rel, as);

  const facts = whole
    ? [note ?? "new file", `${code.split("\n").length} lines`]
    : [note ?? "excerpt", `lines ${lineRange(full, code).join("–")} of the finished file`];

  return `**\`${where}\`** · ${facts.join(" · ")}\n\n\`\`\`${lang}\n${code}\n\`\`\``;
}

/** Pull `|as:` and `|note:` off the end of a placeholder body. */
function options(body) {
  const opts = {};
  let rest = body;
  for (;;) {
    const m = rest.match(/\|(as|note):([^|}]*)$/);
    if (!m) break;
    opts[m[1]] = m[2].trim();
    rest = rest.slice(0, m.index);
  }
  return { rest, ...opts };
}

let count = 0;
const rendered = read("BUILD.tmpl.md")
  .replace(/\{\{FILE:([^}]+)\}\}/g, (_, raw) => {
    count++;
    const { rest, as, note } = options(raw);
    return block(rest.trim(), { as, note });
  })
  .replace(/\{\{SLICE:([\s\S]+?)\}\}/g, (_, raw) => {
    count++;
    const { rest, as, note } = options(raw);
    const colon = rest.indexOf(":");
    const rel = rest.slice(0, colon).trim();
    const [start, end] = rest.slice(colon + 1).split(":::");

    const full = read(rel);
    const from = full.indexOf(start);
    if (from === -1) throw new Error(`sync: marker not found in ${rel}:\n${start.slice(0, 60)}`);
    let body;
    if (!end) body = full.slice(from).trimEnd();
    else {
      const to = full.indexOf(end, from);
      if (to === -1) throw new Error(`sync: end marker not found in ${rel}:\n${end.slice(0, 60)}`);
      body = full.slice(from, to).trimEnd();
    }
    return block(rel, { as, note, body });
  }) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== rendered) {
    console.error("BUILD.md is stale — run: node sync.mjs");
    process.exit(1);
  }
  console.log(`BUILD.md is up to date (${count} listings)`);
} else {
  fs.writeFileSync(OUT, rendered);
  console.log(`wrote BUILD.md — ${count} listings, each labelled with its path`);
}
