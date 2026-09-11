// agent.ts — the TERMINAL interface. All the agent logic lives in mentor.ts;
// this file only knows about readline and ANSI escape codes.
//
// Run:  npm run dev
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Mentor, MODEL } from "./mentor.js";
import { readState } from "./tools.js";
import { DEFAULT_MODALITY, isModalityId, MODALITIES, type ModalityId } from "./modalities.js";

const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
};

function printState(): void {
  const s = readState();
  console.log(`\n${c.bold("  goals")}`);
  if (!s.goals.length) console.log(c.dim("    (none yet)"));
  for (const g of s.goals) {
    const status = g.status && g.status !== "open"
      ? ` ${g.status === "kept" ? c.blue(`[${g.status}]`) : c.amber(`[${g.status}]`)}`
      : "";
    console.log(`    • ${g.goal}${g.deadline ? c.dim(` — ${g.deadline}`) : ""}${status}`);
    console.log(c.dim(`      ${g.outcome ? `what happened: ${g.outcome}` : `why: ${g.why}`}`));
  }
  console.log(`\n${c.bold("  limiting beliefs")}`);
  if (!s.beliefs.length) console.log(c.dim("    (none yet)"));
  for (const b of s.beliefs) {
    console.log(`    • ${b.belief} ${c.dim(`[${b.distortion}]`)}`);
  }
  console.log();
}

async function main(): Promise<void> {
  const state = readState();

  console.log();
  console.log(`  ${c.bold(c.violet("mentor"))} ${c.dim("·")} ${c.bold("accountability partner")}`);
  console.log(`  ${c.dim(`model: ${MODEL} — /mode to switch lens, /state for memory, /exit to leave`)}`);
  console.log(`  ${c.dim(`memory: ${state.goals.length} goal(s), ${state.beliefs.length} flagged belief(s)`)}`);
  console.log();

  // MODALITY=istdp npm run dev  — or /mode istdp once you're in.
  const startId: ModalityId = isModalityId(process.env.MODALITY)
    ? process.env.MODALITY : DEFAULT_MODALITY;
  const mentor = new Mentor(startId);
  console.log(`  ${c.dim(`lens: ${MODALITIES[startId].name} — ${MODALITIES[startId].blurb}`)}`);
  const rl = readline.createInterface({ input: stdin, output: stdout });

  // Ctrl+C cancels the turn in flight rather than killing the session.
  rl.on("SIGINT", () => {
    if (mentor.interrupt()) return;
    console.log(c.dim("\n  bye\n"));
    process.exit(0);
  });

  while (true) {
    let line: string;
    try {
      line = (await rl.question(c.blue("\n› "))).trim();
    } catch {
      break;                                   // Ctrl+D
    }
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    if (line === "/state") { printState(); continue; }

    if (line === "/mode" || line.startsWith("/mode ")) {
      const arg = line.slice(5).trim().toLowerCase();
      if (!arg) {
        console.log(`\n${c.bold("  lenses")}`);
        for (const m of Object.values(MODALITIES)) {
          const mark = m.id === mentor.modality ? c.violet(" ●") : "  ";
          console.log(`  ${mark} ${c.bold(m.id.padEnd(11))}${m.blurb}`);
        }
        console.log(c.dim("\n    /mode <name> — switches lens and keeps the conversation\n"));
        continue;
      }
      if (!isModalityId(arg)) {
        console.log(c.red(`  unknown lens: ${arg} — try /mode`));
        continue;
      }
      mentor.setModality(arg);
      console.log(c.violet(`\n  now working as ${MODALITIES[arg].name} — ${MODALITIES[arg].blurb}\n`));
      continue;
    }

    try {
      let started = false;
      const turn = await mentor.send(line, {
        onFirstToken: () => { started = true; stdout.write(`\n${c.violet("mentor")}  `); },
        onDelta: (text) => stdout.write(text),
        // Tool calls are visible on purpose. The user should see the moment a
        // commitment gets written down — that is what makes it a commitment.
        onTool: (event) => {
          const mark = event.name === "web_search" || event.name === "find_support" ? "⌕" : "✎";
          stdout.write(`${started ? "\n" : ""}${c.amber(`  ${mark} ${event.label}`)}\n`);
          // Where a claim came from belongs on screen, not buried in the
          // model's context. Unsourced facts are the thing search was added
          // to avoid, so hiding the sources would defeat the point.
          for (const src of event.sources ?? []) {
            stdout.write(c.dim(`      ${src.title.slice(0, 62)}\n      ${src.url}\n`));
          }
          started = false;
        },
      });
      console.log();
      if (turn.interrupted) console.log(c.amber("  ⨯ interrupted"));
    } catch (err) {
      console.log(c.red(`  error: ${(err as Error).message}`));
    }
  }

  rl.close();
  console.log(c.dim("\n  Your commitments are saved. They'll be waiting.\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
