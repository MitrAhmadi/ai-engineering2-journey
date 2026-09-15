// Part 1's agent core: a streaming chat agent with no tools at all.
//
// Everything in this file survives to the end of the workshop. The parts that
// come later add tools, a simulated canvas for the eval, and a longer prompt —
// but this shape, streamText with a system prompt and a step limit, is the
// agent, and it is already complete.
import { streamText, stepCountIs, type LanguageModel, type ModelMessage } from "ai";

export const SYSTEM_PROMPT = `You are a diagram design assistant. Right now you have no tools,
so you cannot draw anything yet — say so plainly if you are asked to. Be brief.`;

export const MAX_STEPS = 8;

export function streamAgent({
  model,
  messages,
  system = SYSTEM_PROMPT,
  maxSteps = MAX_STEPS,
}: {
  model: LanguageModel;
  messages: ModelMessage[];
  system?: string;
  maxSteps?: number;
}) {
  return streamText({
    model,
    system,
    messages,
    stopWhen: stepCountIs(maxSteps),
  });
}
