import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import OpenAI from "openai";
import { recallBlock, runTool, TOOLS } from "./tools";
import { OPERATING_NOTE, SYSTEM_PROMPT } from "./prompts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const banner = "Welcome to the Awesome Agent!";
console.log(banner);

const client = new OpenAI();
const MODEL = process.env.MODEL ?? "gpt-4";

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: SYSTEM_PROMPT + OPERATING_NOTE + recallBlock(),
  },
];

const rl = readline.createInterface({ input: stdin, output: stdout });

while (true) {
  let line: string;
  try {
    line = (await rl.question("\n› ")).trim();
  } catch {
    break; // Ctrl+D closes the input stream
  }
  if (!line) continue;
  if (line === "/exit") break;

  messages.push({ role: "user", content: line });

  for (let step = 0; step < 6; step++) {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      stream: true,
    });

    let content = "";
    const calls: { id: string; name: string; args: string }[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        stdout.write(delta.content);
      }

      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }

    const toolCalls = calls.filter(Boolean);
    messages.push({
      role: "assistant",
      content: content || null,
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          }
        : {}),
    } as OpenAI.Chat.ChatCompletionMessageParam);

    if (!toolCalls.length) break;

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.args || "{}");
      const result = runTool(tc.name, args);
      console.log(`\n  ✎ ${tc.name}: ${args.goal ?? args.distortion}`);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  console.log();
  //   console.log("message array:", messages);
}

rl.close();
