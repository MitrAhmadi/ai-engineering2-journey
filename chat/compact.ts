import { openai, type Messages } from "./client.js";
import { COMPACT_AT, COMPACT_SYSTEM_PROMPT, MAX_CONTEXT_TOKENS, MODEL } from "./config.js";
import { estimateTokens } from "./context.js";

/** True once the history has grown past the compaction threshold. */
export function shouldCompact(messages: Messages): boolean {
  return estimateTokens(messages) > MAX_CONTEXT_TOKENS * COMPACT_AT;
}

/**
 * Replace the conversation with a single summary of it, so the array stops
 * growing. The first message (our system prompt) is always kept as-is.
 */
export async function compact(messages: Messages): Promise<Messages> {
  const [seed, ...history] = messages;

  // Flatten the history into a transcript for the summarizer to read.
  const transcript = history
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? "");
      return `${message.role}: ${content}`;
    })
    .join("\n");

  const completion = await openai.chat.completions.create({
    messages: [
      { role: "developer", content: COMPACT_SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    model: MODEL,
  });

  const summary = completion.choices[0].message.content ?? "";
  return [
    seed,
    { role: "developer", content: `Summary of the conversation so far:\n${summary}` },
  ];
}
