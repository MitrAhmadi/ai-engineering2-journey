import { tool } from "ai";
import { z } from "zod";

// The first SERVER-side tool: this one has an execute, and it runs on the
// Worker. Nothing about it touches the canvas, so there is no reason to make
// the browser do it.
//
// It is also the first of the three ways to get facts into a model, and it is
// worth naming all three while they are next to each other:
//
//   system prompt  — facts the model should ALWAYS have. Cheap to write,
//                    expensive to keep: you pay for them on every request.
//   a tool (here)  — facts fetched ON DEMAND, when the model decides it needs
//                    them. You pay only when it asks.
//   retrieval      — same on-demand shape, but the source is YOUR corpus
//                    rather than the open web. That is Part 8.
//
// Note the error handling: a failed search returns `{ error }` as a normal
// tool result. It does not throw. A model that receives "Tavily returned 401"
// can tell the user it could not search; a model whose tool threw sees the
// whole agent loop die.
interface TavilyResult { title?: string; content?: string; url?: string }

export function makeSearchWeb(apiKey: string | undefined) {
  return tool({
    description: `Search the web for current information. Use it when the user asks you to draw a system, product or protocol whose details you may not know accurately — search first, then draw.

Example: searchWeb({ query: "how Cloudflare Durable Objects handle concurrent requests" })`,
    inputSchema: z.object({
      query: z.string().describe("What to search for"),
      maxResults: z.number().optional().describe("Default 5"),
    }),
    execute: async ({ query, maxResults }) => {
      // buildTools does not offer this tool without a key, so this branch is a
      // backstop rather than the main path.
      if (!apiKey) {
        return {
          error:
            "Web search is not configured. Do not call searchWeb again in this " +
            "conversation; draw from what you know and say so.",
        };
      }
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: maxResults ?? 5,
            search_depth: "basic",
          }),
        });
        if (!res.ok) return { error: `Tavily returned ${res.status}` };
        const data = (await res.json()) as { results?: TavilyResult[] };
        // Hand back the three fields the model can use and drop the rest of
        // Tavily's payload. A tool result is context you are paying for.
        return {
          results: (data.results ?? []).map((r) => ({
            title: r.title ?? "",
            content: r.content ?? "",
            url: r.url ?? "",
          })),
        };
      } catch (err) {
        return {
          error:
            `Search failed (${err instanceof Error ? err.message : String(err)}). ` +
            `Do not retry the same query — draw from what you know and say the ` +
            `lookup did not work.`,
        };
      }
    },
  });
}
