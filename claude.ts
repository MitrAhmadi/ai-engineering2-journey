import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { askUser } from "./prompt.js";
// Load environment variables
dotenv.config();

// Reads ANTHROPIC_API_KEY from the environment.
const anthropic = new Anthropic();

async function main() {
  const prompt = await askUser();
  if (!prompt) {
    console.log("No prompt given, exiting.");
    return;
  }

  const response = await anthropic.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: prompt }],
    // If a safety classifier declines the request, retry it on another model
    // inside the same call instead of just stopping.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") {
    console.log("\nClaude declined to answer this one.");
    return;
  }

  // response.content is a list of blocks; pull out the text ones.
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  console.log(`\nAssistant: ${text}`);
}

main();
