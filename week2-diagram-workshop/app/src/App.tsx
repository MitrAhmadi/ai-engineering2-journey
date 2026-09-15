// The browser half of the agent.
//
// Four of the six tools have no `execute` on the Worker. This file is their
// implementation: `onToolCall` receives the call, does the thing to the live
// Excalidraw scene, and posts a result back so the agent loop can continue.
//
// Worth sitting with for a second, because it is the shape of every
// browser-driven agent you will build: the model is running somewhere else,
// and the thing it is manipulating is here. The tool call is the seam.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  convertToExcalidrawElements,
  CaptureUpdateAction,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "./components/Canvas";
import Chat from "./components/Chat";
import { serializeCanvasState } from "./canvas/serialize";
import { findOverlaps } from "./canvas/overlaps";
import { bindAcrossCalls, mergeBoundElements } from "./canvas/bindings";
import "./App.css";

// One agent instance per page load. The canvas lives only in this tab, so a
// persisted conversation would come back referring to a diagram that no longer
// exists — worse than starting fresh.
const sessionId = crypto.randomUUID();

// Our schemas use nullable rather than optional (see element-schema.ts), so the
// model sends every field and fills the unused ones with null. Excalidraw's
// skeleton helper wants `undefined` for "use the default" and throws on
// `label: null`. Recursive, because nested objects carry nulls too.
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  // onToolCall is captured once when the hook initialises, so reading `api`
  // from state inside it would pin the first (null) value forever. The ref is
  // always current.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const agent = useAgent({ agent: "design-agent", name: sessionId });

  const { messages, sendMessage, status } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      const scene = apiRef.current;
      const reply = (output: unknown) =>
        addToolOutput({ toolCallId: toolCall.toolCallId, output });

      if (!scene) return reply({ error: "canvas not ready" });

      switch (toolCall.toolName) {
        case "queryCanvas": {
          return reply({ summary: serializeCanvasState(scene.getSceneElements() as unknown[]) });
        }

        case "addElements": {
          const { elements } = toolCall.input as { elements: unknown[] };
          const cleaned = elements.map(stripNulls) as Record<string, unknown>[];

          // Expand the model's compact elements into real Excalidraw ones:
          // labels become bound text, arrow ids become bindings.
          const drawn = convertToExcalidrawElements(cleaned as never, { regenerateIds: false });

          // …then repair the bindings that point at shapes from earlier calls.
          const existing = scene.getSceneElements();
          const backRefs = bindAcrossCalls(
            cleaned,
            drawn as unknown as { id: string; startBinding?: unknown; endBinding?: unknown }[],
            new Set(existing.map((el) => el.id))
          );
          const patched = existing.map((el) => {
            const incoming = backRefs.get(el.id);
            if (!incoming) return el;
            return newElementWith(el, {
              boundElements: mergeBoundElements(el.boundElements, incoming),
            } as never);
          });

          const next = [...patched, ...drawn];
          scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          scene.scrollToContent(next, { fitToContent: true });

          // The result is feedback, not an acknowledgement: tell the model what
          // it just put on top of what, and it will move things apart.
          return reply({ added: drawn.length, overlaps: findOverlaps(next as unknown[]) });
        }

        case "updateElements": {
          const { updates } = toolCall.input as {
            updates: { id: string; fields: Record<string, unknown> }[];
          };
          const all = scene.getSceneElements();

          const next = all.map((el) => {
            // A shape's label is a separate bound text element, so "change the
            // text" lands on the child, not on the box.
            const forLabel = updates.find(
              (u) => u.id === (el as { containerId?: string }).containerId && u.fields.text != null
            );
            if (forLabel) return newElementWith(el, { text: forLabel.fields.text } as never);

            const update = updates.find((u) => u.id === el.id);
            if (!update) return el;
            const fields: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(update.fields)) {
              if (v !== null && k !== "text") fields[k] = v;
            }
            if (el.type === "text" && update.fields.text != null) fields.text = update.fields.text;
            return Object.keys(fields).length ? newElementWith(el, fields as never) : el;
          });

          scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          return reply({ updated: updates.map((u) => u.id), overlaps: findOverlaps(next as unknown[]) });
        }

        case "removeElements": {
          const { ids } = toolCall.input as { ids: string[] };
          const doomed = new Set(ids);
          const next = scene
            .getSceneElements()
            .filter(
              (el) => !doomed.has(el.id) && !doomed.has((el as { containerId?: string }).containerId ?? "")
            );
          scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          return reply({ removed: ids });
        }

        default:
          return reply({ error: `unknown client tool: ${toolCall.toolName}` });
      }
    },
  });

  const handleApi = useCallback((instance: ExcalidrawImperativeAPI) => setApi(instance), []);

  return (
    <div className="app">
      <Canvas onApiReady={handleApi} />
      <Chat messages={messages} sendMessage={sendMessage} status={status} />
    </div>
  );
}
