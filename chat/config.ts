export const MODEL = "gpt-4.1-nano";

// Pretend the model only has a 1000 token context window.
export const MAX_CONTEXT_TOKENS = 1000;

// Rough rule of thumb: 4 characters ≈ 1 token.
export const CHARS_PER_TOKEN = 4;

// Once the history passes this share of the window, summarize it away.
export const COMPACT_AT = 0.3;

// Pause between streamed chunks, for a typewriter feel. Set to 0 to disable.
export const TYPING_DELAY_MS = 40;

export const SYSTEM_PROMPT = `You are a helpful assistant
please do not call last year weather for today
please talk long about philosophy
  `;

export const COMPACT_SYSTEM_PROMPT = `You compress chat transcripts so a conversation \
can continue in a smaller context window.

Rewrite the transcript below as a brief summary that preserves everything the \
assistant needs to keep talking: facts about the user, decisions made, \
constraints, open questions, and any details the user may refer back to. Drop \
pleasantries, restatements, and anything already resolved. Write it as plain \
notes in the third person. Be concise — aim for well under 150 words.`;
