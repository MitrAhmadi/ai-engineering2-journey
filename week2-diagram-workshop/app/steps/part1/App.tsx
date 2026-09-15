// Part 1's App: canvas on the left, chat on the right, and a live agent — but
// the two halves do not know about each other yet.
//
// Type "draw a box" and it will tell you it cannot. That is the correct
// behaviour for Part 1 and it is worth seeing: the plumbing (Durable Object,
// websocket, streaming, message history) is already working, and the only
// thing missing is a tool.
import { useCallback, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "../../src/components/Canvas";
import Chat from "../../src/components/Chat";
import "../../src/App.css";

const sessionId = crypto.randomUUID();

export default function App() {
  const [, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const handleApi = useCallback((instance: ExcalidrawImperativeAPI) => setApi(instance), []);

  const agent = useAgent({ agent: "design-agent", name: sessionId });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  return (
    <div className="app">
      <Canvas onApiReady={handleApi} />
      <Chat messages={messages} sendMessage={sendMessage} status={status} />
    </div>
  );
}
