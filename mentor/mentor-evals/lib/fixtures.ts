// fixtures.ts — seeded memory, seeded rooms, and the imports of the app itself.
//
// Everything here goes through the app's real public API. An eval that builds
// its own prompt is testing the eval, not the app: the prompts, the operating
// note and the tool schemas are the thing under test, so they must arrive the
// way production gets them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Mentor, type ToolEvent, type TurnResult } from "../../mentor-agent/mentor.ts";
import { Panel, type PanelTurn } from "../../mentor-agent/panel.ts";
import type { Goal, Belief } from "../../mentor-agent/tools.ts";
import type { ModalityId } from "../../mentor-agent/modalities.ts";

export { Mentor, Panel };
export type { ToolEvent, TurnResult, PanelTurn, Goal, Belief, ModalityId };

export interface SeedState {
  goals?: Partial<Goal>[];
  beliefs?: Partial<Belief>[];
}

let counter = 0;

/**
 * Run `fn` against a private, throwaway memory file.
 *
 * MENTOR_STATE is process-global, so anything using this must run serially —
 * suites that call it set `concurrency: 1`. Each call gets its own file so that
 * repeated samples of one case are genuinely independent: without that, the
 * first sample records a goal and the second one sees it in recall, which is a
 * different test than the one you wrote.
 */
export async function withState<T>(seed: SeedState, fn: () => Promise<T>): Promise<T> {
  const file = path.join(os.tmpdir(), `mentor-eval-${process.pid}-${counter++}.json`);
  const now = new Date().toISOString();

  fs.writeFileSync(file, JSON.stringify({
    goals: (seed.goals ?? []).map((g) => ({
      goal: "", why: "", recordedAt: now, status: "open", ...g,
    })),
    beliefs: (seed.beliefs ?? []).map((b) => ({
      belief: "", distortion: "", recordedAt: now, ...b,
    })),
  }, null, 2));

  const previous = process.env.MENTOR_STATE;
  process.env.MENTOR_STATE = file;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.MENTOR_STATE;
    else process.env.MENTOR_STATE = previous;
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

/** Read the memory file the app just wrote. */
export function currentState(): { goals: Goal[]; beliefs: Belief[] } {
  const file = process.env.MENTOR_STATE;
  if (!file) throw new Error("currentState() outside withState()");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export interface TurnUnderTest {
  text: string;
  tools: ToolEvent[];
  toolNames: string[];
  /** The whole reply plus every tool label, for regex-style checks. */
  transcript: string;
}

/** One turn from the 1:1 mentor, with everything an eval wants to look at. */
export async function askMentor(
  input: string,
  opts: { lens?: ModalityId; seed?: SeedState; history?: string[] } = {},
): Promise<TurnUnderTest> {
  return withState(opts.seed ?? {}, async () => {
    const mentor = new Mentor(opts.lens);
    for (const earlier of opts.history ?? []) await mentor.send(earlier);
    const turn: TurnResult = await mentor.send(input);
    return {
      text: turn.text,
      tools: turn.tools,
      toolNames: turn.tools.map((t) => t.name),
      transcript: [turn.text, ...turn.tools.map((t) => t.label)].join("\n"),
    };
  });
}

/** A room with a transcript already in it, for evaluating turn-taking alone. */
export function roomWith(turns: PanelTurn[], members?: ModalityId[]): Panel {
  const panel = new Panel(members);
  panel.load(turns);
  return panel;
}

/** Shorthand for building transcript turns in a test. */
export function said(speaker: PanelTurn["speaker"], text: string, extra: Partial<PanelTurn> = {}): PanelTurn {
  return { speaker, text, at: new Date().toISOString(), ...extra };
}
