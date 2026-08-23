import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import * as dotenv from "dotenv";
import { askUser } from "./prompt.js";
// Load environment variables
dotenv.config();

// The provider reads OPENAI_API_KEY from the environment automatically.

async function main() {
  const prompt = await askUser();
  if (!prompt) {
    console.log("No prompt given, exiting.");
    return;
  }

  const { text } = await generateText({
    model: openai("gpt-4.1-nano"),
    system: "You are a helpful assistant.",
    prompt,
  });

  console.log(`\nAssistant: ${text}`);
}

main();
