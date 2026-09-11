// panel-cli.ts — the terminal interface to the panel. All the logic is in
// panel.ts; this file only knows about readline and ANSI codes.
//
// Run:  npm run panel
//
// The input line stays live the entire time. You do not wait for a prompt —
// type whenever you want and press enter, and whoever is talking gets cut off
// mid-sentence. That is the feature, not a glitch.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Panel, type Bid, type PanelHandlers } from "./panel.js";
import { MODEL } from "./mentor.js";
import { BID_MODEL } from "./panel.js";
import { readState } from "./tools.js";
import { SEARCH_MODEL } from "./search.js";
import { MODALITIES, isModalityId, type ModalityId } from "./modalities.js";

const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[38;5;114m${s}\x1b[0m`,
};

// One colour each, so you can follow who is talking without reading the name.
const VOICE: Record<ModalityId, (s: string) => string> = {
  cbt: c.blue,
  istdp: c.red,
  analytical: c.violet,
  behavioral: c.green,
};

function printState(): void {
  const s = readState();
  console.log(`\n${c.bold("  goals")}`);
  if (!s.goals.length) console.log(c.dim("    (none yet)"));
  for (const g of s.goals) {
    const who = g.modality ? c.dim(` — ${MODALITIES[g.modality].panelName}`) : "";
    const status = g.status && g.status !== "open"
      ? ` ${g.status === "kept" ? c.green(`[${g.status}]`) : c.amber(`[${g.status}]`)}`
      : "";
    console.log(`    • ${g.goal}${g.deadline ? c.dim(` [${g.deadline}]`) : ""}${status}${who}`);
    if (g.outcome) console.log(c.dim(`      ${g.outcome}`));
  }
  console.log(`\n${c.bold("  patterns flagged")}`);
  if (!s.beliefs.length) console.log(c.dim("    (none yet)"));
  for (const b of s.beliefs) {
    const who = b.modality ? MODALITIES[b.modality].panelName : "?";
    console.log(`    • ${b.belief} ${c.dim(`[${b.distortion} — ${who}]`)}`);
  }
  console.log();
}

function bidLine(bids: Bid[]): string {
  return bids
    .map((b) => {
      const txt = `${b.name} ${String(b.score).padStart(3)}`;
      return b.score >= 50 ? VOICE[b.id](txt) : c.dim(txt);
    })
    .join(c.dim("  ·  "));
}

async function main(): Promise<void> {
  // PANEL=istdp,behavioral npm run panel  — or all four by default.
  const members = (process.env.PANEL ?? "cbt,istdp,analytical,behavioral")
    .split(",").map((s) => s.trim().toLowerCase()).filter(isModalityId) as ModalityId[];

  const panel = new Panel(members.length ? members : undefined);
  const state = readState();

  console.log();
  console.log(`  ${c.bold(c.violet("the room"))} ${c.dim("·")} ${c.bold("four practitioners and you")}`);
  for (const id of panel.members) {
    const m = MODALITIES[id];
    console.log(`    ${VOICE[id]("●")} ${c.bold(m.panelName.padEnd(9))}${m.name.padEnd(12)}${c.dim(m.blurb)}`);
  }
  console.log();
  console.log(c.dim(`  speaking: ${MODEL} · bidding for the floor: ${BID_MODEL} · searching: ${SEARCH_MODEL}`));
  console.log(c.dim(`  memory: ${state.goals.length} goal(s), ${state.beliefs.length} pattern(s)`));
  console.log(c.dim(`  type any time — enter cuts off whoever is talking. /state, /bids, /exit`));
  console.log();

  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: c.blue("\n› ") });

  let showBids = true;
  let speaking = false;   // true between onSpeakerStart and onSpeakerEnd

  const handlers: PanelHandlers = {
    onBids: (bids) => {
      if (showBids) console.log(`\n${c.dim("  who wants the floor:")}  ${bidLine(bids)}`);
    },
    onSpeakerStart: (id, name) => {
      speaking = true;
      const m = MODALITIES[id];
      stdout.write(`\n${VOICE[id](c.bold(name))} ${c.dim(m.name)}\n  `);
    },
    onDelta: (_id, text) => stdout.write(text.replace(/\n/g, "\n  ")),
    onTool: (id, event) => {
      const mark = event.name === "web_search" || event.name === "find_support" ? "⌕" : "✎";
      stdout.write(`\n  ${c.amber(`${mark} ${MODALITIES[id].panelName}: ${event.label}`)}\n`);
      for (const src of event.sources ?? []) {
        stdout.write(c.dim(`     ${src.title.slice(0, 62)}\n     ${src.url}\n`));
      }
      stdout.write("  ");
    },
    onSpeakerEnd: (turn) => {
      speaking = false;
      stdout.write(turn.interrupted ? c.amber("  ⨯ cut off\n") : "\n");
    },
    onUser: (turn) => {
      // Only worth marking when it landed mid-sentence; otherwise they can see
      // what they typed one line above.
      if (speaking) console.log(c.dim(`\n  ⤷ you: ${turn.text}`));
    },
    onFloor: (reason) => {
      console.log(c.dim(`\n  — the room is waiting for you  (${reason})`));
    },
  };

  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return;

    if (text === "/exit" || text === "/quit") { rl.close(); return; }
    if (text === "/state") { printState(); rl.prompt(); return; }
    if (text === "/bids") {
      showBids = !showBids;
      console.log(c.dim(`  floor bids ${showBids ? "shown" : "hidden"}`));
      rl.prompt();
      return;
    }

    panel.interject(text);
    if (panel.busy) return;          // the live loop will pick it up

    try {
      await panel.run(handlers);
    } catch (err) {
      console.log(c.red(`\n  error: ${(err as Error).message}`));
    }
    rl.prompt();
  });

  // Ctrl+C stops the room mid-sentence; a second one leaves.
  rl.on("SIGINT", () => {
    if (panel.interrupt()) return;
    rl.close();
  });

  await new Promise<void>((resolve) => rl.on("close", resolve));
  console.log(c.dim("\n  The room remembers. Your commitments are on disk.\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
