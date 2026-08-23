import { CHARS_PER_TOKEN, MAX_CONTEXT_TOKENS } from "./config.js";
import type { Messages } from "./client.js";

/**
 * Estimate how many tokens the messages array takes up.
 * This is a character-count approximation, not the real tokenizer — good
 * enough to see the context filling up as the conversation grows.
 */
export function estimateTokens(messages: Messages): number {
  const text = messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? ""),
    )
    .join("");
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** e.g. "[context: 137/1000 tokens (14%)]" */
export function formatContextUsage(messages: Messages): string {
  const used = estimateTokens(messages);
  const percent = Math.round((used / MAX_CONTEXT_TOKENS) * 100);
  const warning = used > MAX_CONTEXT_TOKENS ? " — over the limit!" : "";
  return `[context: ${used}/${MAX_CONTEXT_TOKENS} tokens (${percent}%)${warning}]`;
}
