#!/usr/bin/env node
// sync.mjs — re-splice the guide's code listings from the real source files.
//
//   node guide/sync.mjs           update the guide in place
//   node guide/sync.mjs --check   fail if anything is stale (for CI)
//
// A tutorial whose code has drifted from the code is worse than no tutorial,
// because the reader trusts it. Every fenced block in the guide that came from
// a real file is found by matching its opening lines against that file, and
// replaced with the file's current contents.
//
// Blocks that are hand-written prose examples, or that come from the
// intermediate teaching versions in sessions 1-3, are left alone — they are not
// in the repo and are not supposed to change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GUIDE = path.join(ROOT, "guide");

const SOURCES = [
  "mentor-agent/modalities.ts",
  "mentor-agent/search.ts",
  "mentor-agent/tools.ts",
  "mentor-agent/panel.ts",
  "mentor-agent/panel-cli.ts",
  "mentor-gui/client/src/main.tsx",
  "mentor-gui/client/src/App.tsx",
  "mentor-gui/client/src/Solo.tsx",
  "mentor-gui/client/src/Room.tsx",
  "mentor-gui/client/src/Avatar.tsx",
  "mentor-gui/client/src/ToolReceipt.tsx",
  "mentor-gui/client/src/RichText.tsx",
  "mentor-gui/client/src/app.css",
];

/** Identify a block by its first few lines — every source here opens with a
 *  distinctive banner comment, or in the stylesheet's case a distinctive
 *  opening rule. Three lines is enough to be unambiguous and short enough to
 *  survive edits further down the file. */
const KEY_LINES = 3;
const keyOf = (text) => text.split("\n").slice(0, KEY_LINES).join("\n").trim();

const sources = SOURCES.map((rel) => {
  const body = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\n+$/, "");
  return { rel, body, key: keyOf(body) };
});

const dupes = sources.filter((s, i) => sources.findIndex((o) => o.key === s.key) !== i);
if (dupes.length) {
  console.error(`ambiguous opening lines: ${dupes.map((d) => d.rel).join(", ")}`);
  process.exit(2);
}

const check = process.argv.includes("--check");
let changed = 0;
const stale = [];

for (const file of fs.readdirSync(GUIDE).filter((f) => f.endsWith(".md"))) {
  const full = path.join(GUIDE, file);
  const before = fs.readFileSync(full, "utf8");

  const after = before.replace(/```([a-z]*)\n([\s\S]*?)\n```/g, (whole, lang, body) => {
    const src = sources.find((s) => s.key === keyOf(body));
    if (!src) return whole;
    if (src.body === body) return whole;
    stale.push(`${file}: ${src.rel}`);
    changed++;
    return "```" + lang + "\n" + src.body + "\n```";
  });

  if (after !== before && !check) fs.writeFileSync(full, after);
}

if (check) {
  if (stale.length) {
    console.error(`guide is stale:\n  ${stale.join("\n  ")}\n\nrun: node guide/sync.mjs`);
    process.exit(1);
  }
  console.log("guide is in sync with the source");
} else {
  console.log(changed ? `updated ${changed} listing(s):\n  ${stale.join("\n  ")}` : "already in sync");
}
