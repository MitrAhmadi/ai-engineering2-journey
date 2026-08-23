import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/** Ask the user for a single line of input. Returns "" if they enter nothing. */
export async function askUser(): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const prompt = (await rl.question("You: ")).trim();
  rl.close();
  return prompt;
}

/**
 * A readline interface that stays open across many turns.
 * Call close() when the chat ends.
 */
export function createChatPrompt() {
  const rl = readline.createInterface({ input, output });
  // Iterate lines rather than calling question() repeatedly: this keeps
  // working when stdin is a pipe or a file, not just an interactive terminal.
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(): Promise<string> {
      output.write("\nYou: ");
      const { value, done } = await lines.next();
      // done means stdin hit EOF (Ctrl-D, or piped input ran out).
      return done ? "" : value.trim();
    },
    close: () => rl.close(),
  };
}

/** True for the inputs that should end the chat: empty, "exit" or "quit". */
export function isExit(text: string): boolean {
  return text === "" || text === "exit" || text === "quit";
}
