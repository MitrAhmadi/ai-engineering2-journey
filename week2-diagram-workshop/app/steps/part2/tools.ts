import { tool } from "ai";
import { z } from "zod";

// The Part 2 tool surface: one tool, elements described the obvious way.
//
// This is what almost everyone writes first, and there is nothing stupid about
// it — it mirrors how Excalidraw's own JSON looks. A shape is a shape, a label
// is a text element, an arrow has coordinates.
//
// Keep it. In Part 4 you will measure it, and in Part 5 you will replace it
// with the schema in src/tools/element-schema.ts and measure again. The gap
// between those two numbers is the argument for spending an afternoon on a
// tool schema instead of on a prompt.
const flatElement = z.object({
  id: z.string(),
  type: z.enum(["rectangle", "ellipse", "diamond", "arrow", "line", "text"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  // A caption is its own element here, floating at whatever coordinates the
  // model picked. Nothing ties it to the box it is meant to be inside.
  text: z.string().nullable(),
  strokeColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
});

export const generateDiagram = tool({
  description: `Draw a diagram on the canvas. Provide every element: shapes, arrows, and text labels.

Example: generateDiagram({ elements: [
  { type: "rectangle", id: "rect1", x: 100, y: 100, width: 200, height: 80, text: null, strokeColor: null, backgroundColor: null },
  { type: "text", id: "text1", x: 150, y: 130, width: 100, height: 25, text: "Start", strokeColor: null, backgroundColor: null },
  { type: "arrow", id: "arrow1", x: 300, y: 140, width: 100, height: 0, text: null, strokeColor: null, backgroundColor: null }
]})`,
  inputSchema: z.object({ elements: z.array(flatElement) }),
  strict: true,
});

export const modifyDiagram = tool({
  description: `Change elements that are already on the canvas. Pass the id and the fields to change.

Example: modifyDiagram({ updates: [{ id: "rect1", x: null, y: null, width: null, height: null, text: null, strokeColor: null, backgroundColor: "#fa5252" }] })`,
  inputSchema: z.object({
    updates: z.array(
      z.object({
        id: z.string(),
        x: z.number().nullable(),
        y: z.number().nullable(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        text: z.string().nullable(),
        strokeColor: z.string().nullable(),
        backgroundColor: z.string().nullable(),
      })
    ),
  }),
  strict: true,
});

// Part 2 has no queryCanvas: the agent cannot see the canvas at all yet. Part 5
// is where that changes, and the modify cases in the eval are what force it.
export function buildTools() {
  return { generateDiagram, modifyDiagram };
}
