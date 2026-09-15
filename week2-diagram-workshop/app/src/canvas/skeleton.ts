// A tiny stand-in for Excalidraw's `convertToExcalidrawElements`.
//
// In the browser, the model's compact element ("a rectangle with a label") is
// expanded by Excalidraw into what the scene actually holds: the rectangle,
// PLUS a separate text element bound to it by containerId, PLUS the
// boundElements back-reference. Arrows get startBinding/endBinding resolved
// from the ids the model supplied.
//
// The eval has no browser. If it scored the model's raw output it would be
// grading a claim rather than a drawing — "I labelled the box" would pass even
// when the label never rendered. So the eval expands the same way, here, and
// the scorers read the expanded scene.
//
// This is the general shape of honest offline evaluation: run the model's
// output through as much of the real pipeline as you can before you score it.
import type { DiagramElement } from "../tools/element-schema";

type Any = Record<string, unknown>;

export function applySkeleton(elements: unknown[], existingIds: Iterable<string> = []): Any[] {
  const out: Any[] = [];
  // Ids an arrow may legally bind to: the ones in this batch, plus whatever is
  // already on the canvas. The browser does the same repair in
  // canvas/bindings.ts — if the eval skipped it, it would report unbound
  // arrows on every "add X between Y and Z" case that production handles fine.
  const known = new Set<string>(existingIds);
  for (const el of elements as (DiagramElement & Any)[]) known.add(el.id);

  for (const el of elements as (DiagramElement & Any)[]) {
    const { label, start, end, ...rest } = el as Any & {
      label?: { text?: string; fontSize?: number | null } | null;
      start?: { id?: string } | null;
      end?: { id?: string } | null;
    };

    const shape: Any = { ...rest, boundElements: [] as { id: string; type: string }[] };

    // Arrow bindings: only resolve ids that exist. An arrow pointing at a
    // shape nobody created is a floating arrow, and the eval should see it
    // as one rather than quietly repairing it.
    if (el.type === "arrow") {
      shape.startBinding = start?.id && known.has(start.id) ? { elementId: start.id } : null;
      shape.endBinding = end?.id && known.has(end.id) ? { elementId: end.id } : null;
    }

    out.push(shape);

    // A shape label becomes a child text element, exactly as Excalidraw does.
    if (label?.text) {
      const textId = `${el.id}_label`;
      out.push({
        id: textId,
        type: "text",
        text: label.text,
        fontSize: label.fontSize ?? 20,
        containerId: el.id,
        // Centred in the container, like the real thing.
        x: (el.x ?? 0) + (el.width ?? 0) / 4,
        y: (el.y ?? 0) + (el.height ?? 0) / 2 - 10,
        width: Math.max(10, (el.width ?? 0) / 2),
        height: 20,
      });
      (shape.boundElements as { id: string; type: string }[]).push({ id: textId, type: "text" });
    }
  }

  // Back-references from shapes to the arrows that bind them. Excalidraw keeps
  // these so moving a box drags its arrows along.
  for (const el of out) {
    if (el.type !== "arrow") continue;
    for (const key of ["startBinding", "endBinding"] as const) {
      const binding = el[key] as { elementId: string } | null;
      if (!binding) continue;
      const target = out.find((candidate) => candidate.id === binding.elementId);
      if (target) {
        (target.boundElements as { id: string; type: string }[]).push({
          id: el.id as string,
          type: "arrow",
        });
      }
    }
  }

  return out;
}
