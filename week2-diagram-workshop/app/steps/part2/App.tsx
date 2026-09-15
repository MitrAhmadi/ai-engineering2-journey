// Part 2's App: the first client-side tool.
//
// The agent now has generateDiagram and modifyDiagram, neither of which has an
// `execute` on the Worker. This handler is their implementation. The model's
// elements are dropped onto the canvas almost verbatim — flat shapes, free
// floating text, arrows with coordinates and no bindings.
//
// It works, and the diagrams look plausible. Part 4 measures how plausible.
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "../../src/components/Canvas";
import Chat from "../../src/components/Chat";
import "../../src/App.css";

const sessionId = crypto.randomUUID();

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const agent = useAgent({ agent: "design-agent", name: sessionId });

  const { messages, sendMessage, status } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      const scene = apiRef.current;
      const reply = (output: unknown) => addToolOutput({ toolCallId: toolCall.toolCallId, output });
      if (!scene) return reply({ error: "canvas not ready" });

      if (toolCall.toolName === "generateDiagram") {
        const { elements } = toolCall.input as { elements: Record<string, unknown>[] };
        // Excalidraw needs more fields than the model sends, so we fill in the
        // defaults by hand. Part 5 deletes all of this: the skeleton helper
        // does it properly, including the bindings we cannot do here.
        const drawn = elements.map((el) => ({
          ...el,
          strokeColor: el.strokeColor ?? "#1e1e1e",
          backgroundColor: el.backgroundColor ?? "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          angle: 0,
          seed: Math.floor(Math.random() * 100000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 100000),
          isDeleted: false,
          groupIds: [],
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
          ...(el.type === "arrow" || el.type === "line"
            ? { points: [[0, 0], [el.width ?? 0, el.height ?? 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow" }
            : {}),
          ...(el.type === "text"
            ? { fontSize: 20, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, originalText: el.text ?? "", lineHeight: 1.25 }
            : {}),
        }));

        const next = [...scene.getSceneElements(), ...(drawn as never[])];
        scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        scene.scrollToContent(next, { fitToContent: true });
        return reply({ added: drawn.length });
      }

      if (toolCall.toolName === "modifyDiagram") {
        const { updates } = toolCall.input as { updates: Record<string, unknown>[] };
        const next = scene.getSceneElements().map((el) => {
          const update = updates.find((u) => u.id === el.id);
          if (!update) return el;
          const fields: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(update)) if (k !== "id" && v !== null) fields[k] = v;
          return newElementWith(el, fields as never);
        });
        scene.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        return reply({ updated: updates.map((u) => u.id) });
      }

      return reply({ error: `unknown tool: ${toolCall.toolName}` });
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
