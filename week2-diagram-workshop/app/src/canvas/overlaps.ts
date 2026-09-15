// Overlap detection: the cheapest quality signal in the whole project.
//
// Models are bad at coordinates. Not a little bad — reliably bad, in a
// specific way: they produce plausible-looking numbers that put two boxes on
// top of each other, and then describe the result as a clean diagram, because
// they cannot see it.
//
// You can attack that with a better prompt (Part 6 does: a layout grid with
// fixed strides), and you should. But the prompt is advice given before the
// fact. This is evidence returned after it. We compute which boxes collide and
// hand that back IN THE TOOL RESULT — so the model reads "rect_api overlaps
// rect_db" the way it reads any other tool output, and moves them apart on its
// next call.
//
// Two lessons hide in this file:
//   - A tool result is not just data, it is feedback. The model can act on
//     what you put there. Most tools return `{ ok: true }` and waste the slot.
//   - The same function scores the eval (`noOverlaps`) and steers the agent at
//     run time. One definition of "good", used in both places, cannot drift.

interface Box {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  containerId?: string | null;
}

// Arrows are allowed to cross things — that is their job. Labels live inside
// their container by definition. Neither counts as an overlap.
const counts = (el: Box) =>
  !el.isDeleted &&
  !el.containerId &&
  el.type !== "arrow" &&
  el.type !== "line" &&
  (el.width ?? 0) > 0 &&
  (el.height ?? 0) > 0;

/** Pairs of element ids whose bounding boxes intersect. */
export function findOverlaps(elements: unknown[]): [string, string][] {
  const boxes = (elements as Box[]).filter(counts);
  const hits: [string, string][] = [];

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ax2 = (a.x ?? 0) + (a.width ?? 0);
      const ay2 = (a.y ?? 0) + (a.height ?? 0);
      const bx2 = (b.x ?? 0) + (b.width ?? 0);
      const by2 = (b.y ?? 0) + (b.height ?? 0);

      // Touching edges is fine; only a real intersection counts.
      const separated =
        ax2 <= (b.x ?? 0) || bx2 <= (a.x ?? 0) || ay2 <= (b.y ?? 0) || by2 <= (a.y ?? 0);

      if (!separated) hits.push([a.id, b.id]);
    }
  }
  return hits;
}
