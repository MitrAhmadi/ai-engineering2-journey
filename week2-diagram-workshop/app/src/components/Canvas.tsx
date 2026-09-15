import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

// Excalidraw, and one line that matters: `excalidrawAPI` hands us the
// imperative handle. That handle — getSceneElements() and updateScene() — is
// the entire interface between the agent and the drawing. Everything the agent
// can see or change on this canvas goes through those two methods.
export default function Canvas({
  onApiReady,
}: {
  onApiReady: (api: ExcalidrawImperativeAPI) => void;
}) {
  return (
    <div className="canvas">
      <Excalidraw excalidrawAPI={onApiReady} />
    </div>
  );
}
