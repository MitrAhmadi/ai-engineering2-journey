import { tool } from "ai";
import { z } from "zod";
import { elementSchema } from "./element-schema";

// A CLIENT-SIDE tool: notice there is no `execute`.
//
// When the model calls a tool that has no execute function, the AI SDK does
// not run anything on the server. The call is streamed to the browser as part
// of the assistant message, the browser fulfils it (App.tsx applies the
// elements to the live Excalidraw scene) and sends a result back, and the
// agent loop resumes with that result in context.
//
// That is the whole architecture of this app in one sentence: the canvas lives
// in the browser, so the tools that touch the canvas run in the browser.
export const addElements = tool({
  description: `Add new elements to the canvas. Use this to draw a new diagram or to extend an existing one.

To put text inside a shape, set that shape's \`label\` field. Do NOT create a separate text element for it — a floating text element on top of a box is not a label and will not move with the box.

// 

`,
  inputSchema: z.object({
    elements: z.array(elementSchema).describe("The elements to add"),
  }),
  // Strict mode: the model physically cannot emit a call that fails to
  // validate. Pair it with the nullable fields in element-schema.ts.
  strict: true,
});
