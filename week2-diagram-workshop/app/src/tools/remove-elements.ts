import { tool } from "ai";
import { z } from "zod";

// Client-side. The browser deletes these ids from the scene.
export const removeElements = tool({
  description: `Delete elements from the canvas by id. The ids must be real — call queryCanvas first if you are not certain what is there.

Example: removeElements({ ids: ["rect_old", "arrow_stale"] })`,
  inputSchema: z.object({
    ids: z.array(z.string()).describe("Element ids to delete"),
  }),
  strict: true,
});
