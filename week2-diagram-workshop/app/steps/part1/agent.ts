import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { streamAgent } from "./agent-core";

// The agent is a Durable Object.
//
// That is the whole reason this app runs on Cloudflare rather than a plain
// server. A Durable Object is a single-instance, addressable, stateful worker:
// one per session id, with its own SQLite storage. `AIChatAgent` uses that to
// keep the message history — you do not manage a sessions table, you do not
// pass the transcript back and forth, and two browser tabs on the same id see
// the same conversation.
//
// Everything interesting happens in agent-core.ts. This class is the adapter
// between Cloudflare's runtime and that file: pull the keys out of env, build
// the model, hand over the messages, return the stream.
//
// Part 8 adds one more thing to it — the only piece of safety that cannot live
// anywhere else — once you have seen why it is needed.
interface Env {
  OPENAI_API_KEY: string;
}

export class DesignAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });

    const result = streamAgent({
      model: openai.chat("gpt-5.4"),
      messages: await convertToModelMessages(this.messages),
    });

    return result.toUIMessageStreamResponse();
  }
}
