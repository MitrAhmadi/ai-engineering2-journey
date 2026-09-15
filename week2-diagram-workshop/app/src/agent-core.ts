// The agent itself — and the one file the eval and production genuinely share.
//
// Two entry points over the same prompt, the same tools and the same step
// limit:
//
//   streamAgent()  the Worker calls this. Streams tokens and tool calls to the
//                  browser, where four of the six tools are fulfilled.
//   runAgent()     the eval calls this. No browser exists, so it simulates one:
//                  an in-memory canvas that the canvas tools read and write.
//
// Why they must live together: the moment your eval builds its own prompt or
// its own tool set, it stops measuring your agent and starts measuring a
// sibling of your agent. Every number it gives you is then a guess about
// something you do not ship.
import {
  generateText,
  streamText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { buildTools, type ToolEnv } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { serializeCanvasState } from "./canvas/serialize";
import { findOverlaps } from "./canvas/overlaps";
import { applySkeleton } from "./canvas/skeleton";

export { SYSTEM_PROMPT };

/**
 * The system prompt names six tools. A deployment without a Tavily key or an
 * Upstash index only has four, and a prompt that advertises tools the model
 * cannot call produces exactly the failure you would expect: it announces that
 * it will look something up, tries, fails, and tries again.
 *
 * One canonical prompt, plus a line of errata per deployment.
 */
function describeMissing(tools: Record<string, unknown>): string | undefined {
  const missing = ["searchWeb", "searchKnowledge"].filter((name) => !tools[name]);
  if (!missing.length) return undefined;
  return (
    `NOT AVAILABLE in this deployment: ${missing.join(" and ")}. ` +
    `Ignore every mention of ${missing.length > 1 ? "them" : "it"} above. Do not ` +
    `announce lookups you cannot perform — draw from what you know, and say when ` +
    `a detail is your best guess rather than something you checked.`
  );
}

// A diagram takes a handful of steps: look, draw, fix the overlaps, reply.
// Eight is generous. The limit exists so a confused model cannot loop forever
// on your account — the same rule as any agent loop.
export const MAX_STEPS = 8;

interface AgentArgs {
  model: LanguageModel;
  messages: ModelMessage[];
  system?: string;
  /** Appended to the system prompt for this call only. */
  extraSystem?: string;
  /** "none" takes the tools away without removing them from context. */
  toolChoice?: "auto" | "none";
  maxSteps?: number;
  env?: ToolEnv;
  /**
   * Swap the whole tool surface. Production never passes this; the eval does,
   * so you can run the same dataset against an older design and see what the
   * new one bought you. A tool schema is a design decision, and design
   * decisions deserve numbers.
   */
  tools?: Record<string, unknown>;
}

/** Live chat. Tool calls stream to the browser; the browser draws. */
export function streamAgent({
  model,
  messages,
  system = SYSTEM_PROMPT,
  extraSystem,
  toolChoice,
  maxSteps = MAX_STEPS,
  env = {},
}: AgentArgs) {
  const tools = buildTools(env);
  const notes = [describeMissing(tools), extraSystem].filter(Boolean);

  return streamText({
    model,
    system: notes.length ? `${system}\n\n${notes.join("\n\n")}` : system,
    messages,
    tools,
    ...(toolChoice ? { toolChoice } : {}),
    // Bounds the steps WITHIN this request. It is not a bound on the turn —
    // see the comment on TURN_BUDGET in agent.ts, which is the one that stops
    // a client-tool loop.
    stopWhen: stepCountIs(maxSteps),
  });
}

/**
 * Headless run, for evals.
 *
 * The four canvas tools have no execute — in production the browser is their
 * implementation. Here we supply one: a plain array that stands in for the
 * scene. addElements pushes into it (after expanding labels and bindings the
 * way Excalidraw would), updateElements patches it, removeElements splices it,
 * queryCanvas reads it back.
 *
 * Without this the agent loop would hang on the first queryCanvas: a tool call
 * with no result and no browser to answer it.
 */
export async function runAgent({
  model,
  messages,
  system = SYSTEM_PROMPT,
  maxSteps = MAX_STEPS,
  env = {},
  seedCanvas = [],
  tools: toolsOverride,
}: AgentArgs & { seedCanvas?: unknown[] }) {
  const scene: Record<string, unknown>[] = (seedCanvas as Record<string, unknown>[]).map((el) => ({
    ...el,
  }));

  const base = buildTools(env);

  /**
   * Give a production tool an executor WITHOUT changing anything else about it.
   *
   * This spread is load-bearing. An earlier version of this file rebuilt each
   * tool by hand from `description` and `inputSchema`, which quietly dropped
   * `strict: true` — so the eval sent a schema production never sends, passed
   * with flying colours, and the live app died on its first request with
   * "'oneOf' is not permitted". The eval was measuring a sibling of the agent.
   *
   * Anything the tool declares, the eval must declare too. Only the execute
   * function is ours.
   */
  const withExecutor = <T>(definition: unknown, execute: (input: T) => Promise<unknown>) =>
    tool({ ...(definition as Record<string, unknown>), execute } as never);

  const tools = {
    queryCanvas: withExecutor(base.queryCanvas, async () => ({
      summary: serializeCanvasState(scene),
    })),
    addElements: withExecutor(base.addElements, async ({ elements }: { elements: unknown[] }) => {
      const existingIds = scene.map((el) => String(el.id));
      for (const el of applySkeleton(elements, existingIds)) {
        // An id that is already on the canvas replaces it rather than appending
        // a second copy — the same thing updateScene does in the browser.
        // Without this, a model that retries a call leaves two elements stacked
        // on the same spot and every overlap number lies.
        const at = scene.findIndex((existing) => existing.id === el.id);
        if (at >= 0) scene[at] = el;
        else scene.push(el);
      }
      // The same feedback the live app gives: what did this call collide with?
      return { added: elements.length, overlaps: findOverlaps(scene) };
    }),
    updateElements: withExecutor(
      base.updateElements,
      async ({ updates }: { updates: { id: string; fields: Record<string, unknown> }[] }) => {
        for (const { id, fields } of updates) {
          const target = scene.find((el) => el.id === id);
          if (!target) continue;
          for (const [key, value] of Object.entries(fields)) {
            if (value === null) continue; // null means "leave it alone"
            // A label lives in a child text element, not on the shape.
            if (key === "text") {
              const label = scene.find((el) => el.containerId === id);
              if (label) label.text = value;
              else target.text = value;
              continue;
            }
            target[key] = value;
          }
        }
        return { updated: updates.map((u) => u.id), overlaps: findOverlaps(scene) };
      }
    ),
    removeElements: withExecutor(base.removeElements, async ({ ids }: { ids: string[] }) => {
        for (const id of ids) {
          const at = scene.findIndex((el) => el.id === id);
          if (at >= 0) scene.splice(at, 1);
          // Its label goes with it.
          for (let i = scene.length - 1; i >= 0; i--) {
            if (scene[i]!.containerId === id) scene.splice(i, 1);
          }
        }
      return { removed: ids };
    }),
    // Present only when configured — see buildTools.
    ...(base.searchWeb ? { searchWeb: base.searchWeb } : {}),
    ...(base.searchKnowledge ? { searchKnowledge: base.searchKnowledge } : {}),
  };

  const missing = describeMissing(tools as Record<string, unknown>);

  const result = await generateText({
    model,
    // Same errata as the live agent: the eval must see the deployment the
    // agent sees, tools and prompt alike.
    system: missing ? `${system}\n\n${missing}` : system,
    messages,
    // An overridden surface gets the same simulated canvas treatment: whatever
    // its tools are called, their output still has to land in `scene` or the
    // scorers would have nothing to read.
    tools: (toolsOverride ? wrapLegacyTools(toolsOverride, scene) : tools) as never,
    stopWhen: stepCountIs(maxSteps) as never,
  });

  // Flat list of tool names in call order. Several scorers care less about the
  // drawing than about whether the agent reached for the right tool at all.
  const toolCalls: string[] = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls ?? []) toolCalls.push(call.toolName);
  }

  return { text: result.text, elements: scene, toolCalls, steps: result.steps };
}

/**
 * Adapter for an older tool surface (Part 2's generateDiagram / modifyDiagram).
 *
 * The scorers do not care what the tools were called — they read the resulting
 * canvas. So we wrap whatever tools we are handed with executors that mirror
 * their effect into the simulated scene. Flat elements go in as-is: no labels
 * are bound, no arrows are bound, which is exactly the weakness the eval is
 * there to expose.
 */
function wrapLegacyTools(surface: Record<string, unknown>, scene: Record<string, unknown>[]) {
  const wrapped: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(surface)) {
    const def = definition as Record<string, unknown>;
    // Spread the whole definition, for the same reason withExecutor does:
    // whatever the tool declares — including strict — the eval must declare too.
    wrapped[name] = tool({
      ...def,
      execute: async (input: Record<string, unknown>) => {
        if (Array.isArray(input.elements)) {
          for (const el of input.elements as Record<string, unknown>[]) scene.push({ ...el });
          return { added: (input.elements as unknown[]).length, overlaps: findOverlaps(scene) };
        }
        if (Array.isArray(input.updates)) {
          for (const update of input.updates as Record<string, unknown>[]) {
            const target = scene.find((el) => el.id === update.id);
            if (!target) continue;
            for (const [key, value] of Object.entries(update)) {
              if (key !== "id" && value !== null) target[key] = value;
            }
          }
          return { updated: (input.updates as { id: string }[]).map((u) => u.id) };
        }
        return { ok: true };
      },
    } as never);
  }
  return wrapped;
}
