import type { Scorer } from "../types";

// Is the text inside the boxes, or merely on top of them?
//
// Excalidraw binds a shape's label to the shape via containerId. A model that
// ignores the `label` field and drops a free-floating text element at the same
// coordinates produces something that looks right in a screenshot and comes
// apart the moment the box moves — the same class of failure as an unbound
// arrow, and just as invisible until someone interacts with it.
//
// Scores the fraction of text elements that are properly bound. Floating
// annotations that sit clear of every shape are fine and are not counted.
interface El {
  type?: string;
  containerId?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const inside = (text: El, shape: El) =>
  (text.x ?? 0) >= (shape.x ?? 0) &&
  (text.y ?? 0) >= (shape.y ?? 0) &&
  (text.x ?? 0) <= (shape.x ?? 0) + (shape.width ?? 0) &&
  (text.y ?? 0) <= (shape.y ?? 0) + (shape.height ?? 0);

export const boundLabels: Scorer = ({ output }) => {
  const els = output.elements as El[];
  const texts = els.filter((el) => el.type === "text");
  if (texts.length === 0) return { name: "boundLabels", score: null };

  const shapes = els.filter((el) => ["rectangle", "ellipse", "diamond"].includes(el.type ?? ""));
  let ok = 0;
  let floatingOnShape = 0;
  for (const text of texts) {
    if (text.containerId) ok++;
    else if (shapes.some((shape) => inside(text, shape))) floatingOnShape++;
    else ok++; // a genuine annotation, sitting on its own
  }
  return {
    name: "boundLabels",
    score: ok / texts.length,
    note: floatingOnShape ? `${floatingOnShape} floating text on top of a shape` : "all labels bound",
  };
};
