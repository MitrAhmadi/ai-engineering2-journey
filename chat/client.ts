import OpenAI from "openai";
import * as dotenv from "dotenv";
// Load environment variables
dotenv.config();

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** The conversation history type, aliased so it reads better everywhere else. */
export type Messages = OpenAI.Chat.ChatCompletionMessageParam[];
