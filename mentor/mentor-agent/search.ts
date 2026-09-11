// search.ts — the mentor's only window onto the world outside the conversation.
//
// Everything else this agent does is generated from what it already knows. This
// file is the one place a fact can enter from outside, which is exactly why it
// is deliberately narrow: it answers a question and returns sources, and it
// never decides anything.
//
// It runs on the Responses API's hosted web_search tool, so there is no second
// API key and no scraper to maintain — the same OPENAI_API_KEY that runs the
// conversation runs the search.
import OpenAI from "openai";

// Constructed on first use, not at import. A module that throws merely because
// it was imported cannot be loaded by a test, a type checker, or a tool that
// only wants one exported constant out of it.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

/** Search is a lookup, not a conversation. It does not need the big model. */
export const SEARCH_MODEL = process.env.SEARCH_MODEL ?? "gpt-4o-mini";

export interface Source {
  title: string;
  url: string;
}

export interface SearchResult {
  query: string;
  summary: string;
  sources: Source[];
  /** Set when the lookup failed. Failure is data, not an exception. */
  error?: string;
}

// Four practitioners in one room will reach for the same fact within seconds of
// each other. The cache is per-process and unbounded on purpose: a session is
// short, and paying twice for the same query inside one conversation is silly.
const cache = new Map<string, SearchResult>();

/** OpenAI folds citations into the prose as ([domain](url)). We show sources
 *  separately, so leaving them inline just makes the text unreadable. */
function stripInlineCitations(text: string): string {
  return text
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}

export async function webSearch(query: string, signal?: AbortSignal): Promise<SearchResult> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await client().responses.create(
      {
        model: SEARCH_MODEL,
        tools: [{ type: "web_search_preview" }],
        tool_choice: { type: "web_search_preview" },
        input:
          `${query}\n\nAnswer in at most four sentences. State plainly what the ` +
          `evidence does and does not show. If the sources disagree, say so ` +
          `rather than picking a side. Do not give advice.`,
      },
      { signal },
    );

    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const item of res.output ?? []) {
      for (const part of (item as any).content ?? []) {
        for (const ann of part.annotations ?? []) {
          if (ann.type !== "url_citation" || seen.has(ann.url)) continue;
          seen.add(ann.url);
          sources.push({ title: ann.title ?? new URL(ann.url).hostname, url: ann.url });
        }
      }
    }

    const result: SearchResult = {
      query,
      summary: stripInlineCitations(res.output_text ?? ""),
      sources: sources.slice(0, 5),
    };
    cache.set(key, result);
    return result;
  } catch (err) {
    // A failed lookup must not end the turn. The model is told the search
    // failed and carries on with the conversation, which is what a person
    // would do when a search box times out.
    return {
      query,
      summary: "",
      sources: [],
      error: (err as Error).message ?? "the search failed",
    };
  }
}
