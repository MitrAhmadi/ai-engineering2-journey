import OpenAI from "openai";
import * as dotenv from "dotenv";
import { createChatPrompt, isExit } from "./prompt.js";
// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  // No local history array here: with store: true the API keeps each response,
  // and previous_response_id chains the new turn onto the last one. So we only
  // ever send the newest message and just remember the last response id.
  let lastResponseId: string | undefined;

  const chat = createChatPrompt();
  console.log('Chatting with gpt-4.1-nano. Type "exit" or press enter to quit.');

  while (true) {
    const prompt = await chat.ask();
    if (isExit(prompt)) break;

    const response = await openai.responses.create({
      model: "gpt-4.1-nano",
      instructions: "You are a helpful assistant.",
      input: prompt,
      previous_response_id: lastResponseId,
      store: true,
    });

    lastResponseId = response.id;
    console.log(`\nAssistant: ${response.output_text}`);
  }

  chat.close();
  console.log("Bye.");
}

main();
