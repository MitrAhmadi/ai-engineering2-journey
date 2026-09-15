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
// between Cloudflare's runtime and that file — plus the one piece of safety
// that can only live here: the budget for a whole turn.
interface Env {
  OPENAI_API_KEY: string;
  TAVILY_API_KEY?: string;
  UPSTASH_VECTOR_REST_URL?: string;
  UPSTASH_VECTOR_REST_TOKEN?: string;
}

/**
 * How many model calls one user message may cost.
 *
 * THIS IS NOT `stopWhen: stepCountIs(8)`, and the difference is the most
 * expensive thing in this file.
 *
 * `stopWhen` bounds the steps inside a single streamText call. That is a real
 * bound only while the tools run on the server: the loop happens inside one
 * request, and the counter sees every step of it.
 *
 * Our canvas tools run in the BROWSER. The Worker streams a tool call out, the
 * request ends, the browser draws and posts the result back — and that is a
 * NEW request, a new onChatMessage, a new streamText, with the step counter
 * starting again at zero. Nothing accumulates. An agent that keeps calling
 * tools keeps getting a fresh budget, forever.
 *
 * That is not theoretical. Ask this agent to draw something it wants to look up
 * with a search tool that is not configured, and it will cheerfully cycle
 * search → search → draw → search → draw a hundred and fifty times, billing you
 * for every round and redrawing the canvas on each one.
 *
 * So the bound has to live where the state lives: in the Durable Object, across
 * requests. Count the assistant turns since the user last said something, and
 * when the budget is gone, take the tools away and make it answer.
 */
const TURN_BUDGET = 10;

export class DesignAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });

    // Everything after the user's most recent message is work done on this
    // turn. Each client round trip leaves one assistant message behind.
    const roles = this.messages.map((m: { role: string }) => m.role);
    const lastUser = roles.lastIndexOf("user");
    const spent = roles.slice(lastUser + 1).filter((role) => role === "assistant").length;

    const exhausted = spent >= TURN_BUDGET;

    const result = streamAgent({
      model: openai.chat("gpt-5.4"),
      messages: await convertToModelMessages(this.messages),
      // Out of budget: no more tools this turn. `toolChoice: "none"` leaves the
      // tool definitions in context — so the model can still talk about what it
      // did — while making another call impossible. The loop ends here whether
      // the model agrees or not.
      toolChoice: exhausted ? "none" : undefined,
      extraSystem: exhausted
        ? `You have used every tool call available for this turn. Do not describe ` +
          `further work you intend to do. Tell the user plainly what you managed ` +
          `to draw, what you could not, and stop.`
        : undefined,
      env: {
        TAVILY_API_KEY: this.env.TAVILY_API_KEY,
        UPSTASH_VECTOR_REST_URL: this.env.UPSTASH_VECTOR_REST_URL,
        UPSTASH_VECTOR_REST_TOKEN: this.env.UPSTASH_VECTOR_REST_TOKEN,
      },
    });

    return result.toUIMessageStreamResponse();
  }
}
