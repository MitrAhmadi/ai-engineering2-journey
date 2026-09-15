// One place that assembles the tool set the agent is given.
//
// Four of the six are client-side (no execute — the browser fulfils them) and
// two are server-side. The two server-side ones need per-request secrets, so
// they are built by factory functions rather than exported as constants: a
// Worker gets its env per request, not from a module-level import.
import { addElements } from "./add-elements";
import { updateElements } from "./update-elements";
import { removeElements } from "./remove-elements";
import { queryCanvas } from "./query-canvas";
import { makeSearchWeb } from "./search-web";
import { makeSearchKnowledge } from "./search-knowledge";

export interface ToolEnv {
  TAVILY_API_KEY?: string;
  UPSTASH_VECTOR_REST_URL?: string;
  UPSTASH_VECTOR_REST_TOKEN?: string;
}

/**
 * A tool that cannot work should not be offered.
 *
 * Both search tools return `{ error }` when their credentials are missing —
 * which is the right shape for a RUNTIME failure, and entirely the wrong answer
 * to "this will never work". A model handed a tool that fails every time will
 * try it again, and again, and in a client-tool architecture (where every tool
 * result starts a fresh request with a fresh step budget) that is an infinite
 * loop with a bill attached.
 *
 * So the configuration check happens here, once, before the model ever sees the
 * menu. You cannot be tempted by a tool that is not on it — and the prompt stops
 * lying about capabilities the deployment does not have.
 */
export function buildTools(env: ToolEnv) {
  const tools: Record<string, unknown> = {
    queryCanvas,
    addElements,
    updateElements,
    removeElements,
  };

  if (env.TAVILY_API_KEY) tools.searchWeb = makeSearchWeb(env.TAVILY_API_KEY);
  if (env.UPSTASH_VECTOR_REST_URL && env.UPSTASH_VECTOR_REST_TOKEN) {
    tools.searchKnowledge = makeSearchKnowledge(env);
  }

  return tools as {
    queryCanvas: typeof queryCanvas;
    addElements: typeof addElements;
    updateElements: typeof updateElements;
    removeElements: typeof removeElements;
    searchWeb?: ReturnType<typeof makeSearchWeb>;
    searchKnowledge?: ReturnType<typeof makeSearchKnowledge>;
  };
}
