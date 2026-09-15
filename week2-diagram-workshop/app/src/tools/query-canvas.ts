import { tool } from "ai";
import { z } from "zod";

// Also client-side, and the most interesting of the four.
//
// The agent runs on a Worker. The canvas lives in a browser tab. So how does
// the agent know what is already drawn?
//
// The tempting answer is to serialise the scene into every request — append it
// to the system prompt, or to the user's message. That works, and it is what
// most people build first. It also means you pay for the whole canvas on every
// single turn, including the turns that are just "thanks" or "what can you
// do?", and it goes stale the moment the user drags a box.
//
// The better answer is this: make it a tool, and let the model decide when it
// needs to look. Nothing is spent on turns that do not touch the canvas, and
// when the model does ask, the browser answers from the live scene, so the
// answer cannot be stale.
export const queryCanvas = tool({
  description: `Read what is currently on the canvas. Returns every element with its id, type, position, size and label.

Call this BEFORE modifying or removing anything, so you use real ids instead of guessing. You do not need it before drawing a brand new diagram on an empty canvas.

Example: queryCanvas({})`,
  inputSchema: z.object({}),
  // No execute. The browser answers this one.
});
