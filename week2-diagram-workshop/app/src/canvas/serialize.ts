// Turning a canvas into something a model can read.
//
// An Excalidraw scene is an array of elements with about thirty fields each,
// plus the bookkeeping that makes undo and collaboration work. Sending that
// JSON to the model is possible and wasteful: a six-box diagram is roughly
// 4,000 tokens of mostly `versionNonce`.
//
// So we write a serialiser. One line per element, only the fields the model
// can act on: id, type, where it is, how big it is, what it says, and what an
// arrow connects. A six-box diagram becomes about 120 tokens.
//
// The subtle part is labels. When Excalidraw renders a labelled box it stores
// TWO elements: the rectangle, and a text element whose `containerId` points
// back at it. Read the scene naively and you will report six boxes and six
// mysterious text elements, and the model will start "fixing" the duplicates.
// So we fold each label into its container and never mention it again.

interface SceneElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  backgroundColor?: string;
  strokeColor?: string;
  containerId?: string | null;
  isDeleted?: boolean;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}

const round = (n: number | undefined) => Math.round(n ?? 0);

export function serializeCanvasState(elements: unknown[]): string {
  const scene = (elements as SceneElement[]).filter((el) => el && !el.isDeleted);
  if (scene.length === 0) return "The canvas is empty.";

  // Pass one: collect every text element that belongs to a container.
  const labels = new Map<string, string>();
  for (const el of scene) {
    if (el.type === "text" && el.containerId && el.text) {
      labels.set(el.containerId, el.text);
    }
  }

  // Pass two: one line per real element. Bound labels are skipped — they were
  // folded into their container above.
  const lines: string[] = [];
  for (const el of scene) {
    if (el.type === "text" && el.containerId) continue;

    const label = labels.get(el.id) ?? (el.type === "text" ? el.text : undefined);
    const where = `(${round(el.x)}, ${round(el.y)}) ${round(el.width)}x${round(el.height)}`;

    if (el.type === "arrow" || el.type === "line") {
      const from = el.startBinding?.elementId ?? "unbound";
      const to = el.endBinding?.elementId ?? "unbound";
      lines.push(
        `${el.id} — ${el.type} ${from} → ${to}${label ? ` labelled "${label}"` : ""}`
      );
      continue;
    }

    // Colour is included only when it is set to something. It matters more
    // than it looks: "make the login box red" is a common request, and a
    // summary that omits colour leaves both the agent and the eval judge
    // unable to tell whether it worked.
    const fill =
      el.backgroundColor && el.backgroundColor !== "transparent"
        ? `, filled ${el.backgroundColor}`
        : "";
    const stroke = el.strokeColor && el.strokeColor !== "#1e1e1e" ? `, stroke ${el.strokeColor}` : "";

    lines.push(
      `${el.id} — ${el.type} at ${where}${label ? ` labelled "${label}"` : ""}${fill}${stroke}`
    );
  }

  return `${lines.length} element${lines.length === 1 ? "" : "s"} on the canvas:\n${lines.join("\n")}`;
}
