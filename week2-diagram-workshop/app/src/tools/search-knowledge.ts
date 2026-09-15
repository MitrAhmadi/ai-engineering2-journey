import { tool } from "ai";
import { z } from "zod";
import { getIndex, type VectorEnv } from "../rag/vector-store";

// The RAG tool. Same shape as searchWeb — server-side, on-demand, errors as
// data — pointed at your own corpus instead of the internet.
//
// Why a diagram agent wants this: ask a model to draw "our deployment
// pipeline" and it will draw A deployment pipeline, confidently, from the
// average of everything it has read. It cannot know yours. Three paragraphs of
// retrieved reference text turn a plausible diagram into a correct one.
//
// The retrieved text goes back as a tool result, which means the model reads
// it and then draws. You are not asking it to copy; you are giving it the
// facts it was about to invent.
export function makeSearchKnowledge(env: VectorEnv) {
  return tool({
    description: `Search the private knowledge base for reference material about a system, protocol or process before drawing it. Use it whenever the request names something specific where the details matter and you might be guessing.

Example: searchKnowledge({ query: "OAuth 2.0 authorization code flow with PKCE" })`,
    inputSchema: z.object({
      query: z.string().describe("What you need to know, in natural language"),
    }),
    execute: async ({ query }) => {
      try {
        const results = await getIndex(env).query({ data: query, topK: 3, includeMetadata: true });
        return {
          results: results.map((r) => ({
            source: (r.metadata as { source?: string } | undefined)?.source ?? String(r.id),
            content: (r.metadata as { content?: string } | undefined)?.content ?? "",
            score: r.score,
          })),
        };
      } catch (err) {
        // Say "stop", not just "sorry". A tool result that reads like a
        // transient hiccup invites the model to try again, and again.
        return {
          error:
            `The knowledge base is unavailable (${err instanceof Error ? err.message : String(err)}). ` +
            `Do not call searchKnowledge again in this conversation. Draw from what you ` +
            `know and tell the user you could not consult the reference material.`,
        };
      }
    },
  });
}
