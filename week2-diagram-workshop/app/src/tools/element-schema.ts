// The shape of one diagram element, as the model is allowed to produce it.
//
// This file is the highest-leverage file in the project, and it is worth
// understanding why before reading the code.
//
// Excalidraw's real element type has ~30 fields per element: version, seed,
// versionNonce, updated, frameId, boundElements, and so on. A model asked to
// emit all of that will get some of it wrong on every call. So we do not ask.
// We define the SMALL subset that describes a diagram — type, position, size,
// a label, and for arrows which shapes they connect — and let Excalidraw's own
// `convertToExcalidrawElements` helper fill in everything else.
//
// Two decisions in here do most of the work:
//
//   1. `label` lives ON the shape. The model never creates a separate text
//      element to caption a box. That is the single most common way an
//      LLM-drawn diagram falls apart: the caption is a free-floating text
//      element that does not move when the box moves.
//   2. Arrows carry `start: { id }` / `end: { id }`, not coordinates. The
//      model says WHAT connects to WHAT; Excalidraw computes where the arrow
//      actually attaches and keeps it attached when either shape moves.
//
// Everything is `.nullable()` rather than `.optional()`. That is not a style
// choice — see the note at the bottom of the file.
import { z } from "zod";

const label = z
  .object({
    text: z.string(),
    fontSize: z.number().nullable(),
  })
  .nullable()
  .describe(
    "Text drawn INSIDE this shape. Excalidraw centres and re-flows it for you.",
  );

const binding = z
  .object({ id: z.string() })
  .nullable()
  .describe("id of the shape this end of the arrow attaches to");

/** Fields every element has. */
const base = {
  id: z
    .string()
    .describe(
      "Short meaningful id: rect_user, arrow_user_api. Never element_42.",
    ),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  strokeColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
};

// z.union, NOT z.discriminatedUnion.
//
// They describe the same thing in TypeScript and compile to different JSON
// Schema: discriminatedUnion emits `oneOf`, and OpenAI's strict mode rejects it
// outright —
//
//   Invalid schema for function 'addElements':
//   In context=('properties','elements','items'), 'oneOf' is not permitted.
//
// z.union emits `anyOf`, which strict mode accepts. The model still picks the
// right branch from the `type` literal, so nothing is lost but the error.
export const elementSchema = z.union([
  z.object({ type: z.literal("rectangle"), ...base, label }),
  z.object({ type: z.literal("ellipse"), ...base, label }),
  z.object({ type: z.literal("diamond"), ...base, label }),
  z.object({
    type: z.literal("arrow"),
    ...base,
    label,
    // Without these two an arrow is a line at some coordinates: the model can
    // draw it, but it attaches to nothing and does not follow when a box moves.
    // They are the reason boundArrows goes from 17% to 100% in Part 5.
    start: binding,
    end: binding,
  }),
  z.object({ type: z.literal("line"), ...base, label }),
  z.object({
    // A standalone text element is for floating annotations — a title, a note
    // in the margin. It is NOT how you label a shape.
    type: z.literal("text"),
    ...base,
    text: z.string(),
    fontSize: z.number().nullable(),
  }),
]);

export type DiagramElement = z.infer<typeof elementSchema>;

// ---------------------------------------------------------------------------
// Why nullable and not optional
//
// OpenAI's strict structured outputs mode guarantees the model's arguments
// validate against your schema — no missing fields, no invented ones, no
// malformed JSON to parse defensively. The price is that strict mode does not
// support optional properties: every key in the object must be present in the
// output.
//
// So we mark "you may leave this out" as `.nullable()` instead, and the model
// sends `"strokeColor": null`. Our code strips nulls before handing the object
// to Excalidraw, which expects `undefined` for "use the default" and throws on
// `label: null`.
//
// Verbose on the wire, and worth it: with strict mode on, a whole category of
// runtime failure — the model returning something your code cannot parse —
// stops existing.
