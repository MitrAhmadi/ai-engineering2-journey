import { tool } from "ai";
import { z } from "zod";

// Client-side. The browser patches the named elements in place.
//
// This is the tool that makes the agent feel like a collaborator rather than a
// generator. Without it, "make the login box red" means redrawing the entire
// diagram — new ids, new positions, everything the user had moved by hand
// thrown away. With it, one element changes and the rest of the scene is
// untouched.
//
// Every field is nullable, and null means "leave this alone". Under OpenAI
// strict mode the model must send every key, so a recolour looks like:
//
//   { id: "rect_login", fields: { backgroundColor: "#fa5252", x: null, ... } }
//
// The browser strips the nulls before applying.
const fields = z.object({
  x: z.number().nullable(),
  y: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  text: z.string().nullable().describe("New label text for a shape, or new content for a text element"),
  strokeColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
});

export const updateElements = tool({
  description: `Change properties of elements that are already on the canvas. Pass null for every field you are not changing.

Prefer this over redrawing. If the user asks for one box to move or change colour, update that one box — do not delete the diagram and start again.

Call queryCanvas first unless you already know the ids from this conversation.

Example: updateElements({ updates: [
  { id: "rect_login", fields: { backgroundColor: "#fa5252", x: null, y: null, width: null, height: null, text: null, strokeColor: null } }
]})`,
  inputSchema: z.object({
    updates: z.array(z.object({ id: z.string(), fields })),
  }),
  strict: true,
});
