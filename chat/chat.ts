import { openai, type Messages } from "./client.js";
import { MODEL, SYSTEM_PROMPT, TYPING_DELAY_MS } from "./config.js";
import { formatContextUsage } from "./context.js";
import { compact, shouldCompact } from "./compact.js";
import { runTool, tools } from "./tools.js";
import { createChatPrompt, isExit } from "../prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run the interactive chat loop until the user exits. */
export async function runChat(): Promise<void> {
  // The whole conversation lives here. The API is stateless, so we resend
  // this array on every turn and append each new message to it.
  let messages: Messages = [{ role: "developer", content: SYSTEM_PROMPT }];

  const chat = createChatPrompt();
  console.log(`Chatting with ${MODEL}. Type "exit" or press enter to quit.`);
  console.log(formatContextUsage(messages));

  while (true) {
    const prompt = await chat.ask();
    if (isExit(prompt)) break;

    messages.push({ role: "user", content: prompt });

    // Keep going until the model answers with text instead of a tool call.
    let reply;
    while (true) {
      const stream = openai.chat.completions.stream({
        messages,
        model: MODEL,
        tools,
      });

      // Print each fragment as it arrives instead of waiting for the full reply,
      // pausing between chunks so the text appears at a readable pace.
      let started = false;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (!delta) continue;
        if (!started) {
          process.stdout.write("\nAssistant: ");
          started = true;
        }
        process.stdout.write(delta);
        if (TYPING_DELAY_MS > 0) await sleep(TYPING_DELAY_MS);
      }

      reply = await stream.finalMessage();
      if (started) process.stdout.write("\n");
      messages.push(reply);

      if (!reply.tool_calls?.length) break;

      // Run every requested tool and feed each result back as a tool message.
      for (const call of reply.tool_calls) {
        console.log(`\n[tool] ${call.type === "function" ? call.function.name : call.type}`);
        const result = await runTool(call);
        console.log(`[tool] ${result}`);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    console.log(formatContextUsage(messages));

    if (shouldCompact(messages)) {
      console.log("Compacting...");
      messages = await compact(messages);
      console.log(formatContextUsage(messages));
    }

    // console.log("messages", messages);
  }

  chat.close();
  console.log("Bye.");
}
