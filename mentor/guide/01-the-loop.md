# Session 1 — The loop that streams

**You will build:** a conversation in your terminal that streams its answer a
token at a time.

**Files created:** `package.json`, `tsconfig.json`, `.env`, `.gitignore`,
`agent.ts`

---

## 1. The folder

Make an empty folder and go into it.

```bash
mkdir mentor-agent && cd mentor-agent
npm init -y
npm install openai
npm install -D typescript tsx @types/node
```

Four packages. `openai` is the SDK, `tsx` runs TypeScript directly without a
build step, and the other two are types and the compiler for checking.

## 2. `package.json`

Replace the generated file with this:

```json
{
  "name": "mentor-agent",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx --env-file=.env agent.ts", "typecheck": "tsc --noEmit" }
}
```

The line that matters is `"type": "module"`. It puts the whole project on ES
modules, which is what lets us use `await` at the top level of a file and
`import` rather than `require`.

`--env-file=.env` is Node reading your key out of a file for you. There is no
`dotenv` package in this project.

## 3. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

`"strict": true` is not optional in this project. Half the bugs you would
otherwise hit at runtime — a tool call with no `id`, a chunk with no `delta` —
become red squiggles instead.

## 4. `.env` and `.gitignore`

```bash
echo 'OPENAI_API_KEY=sk-...' > .env
printf 'node_modules\n.env\nstate.json\n' > .gitignore
```

Put your real key in `.env`. **Commit the `.gitignore` before you commit
anything else** — this is the moment keys get leaked, and it is worth saying out
loud in class.

## 5. `agent.ts`

Now the actual program.

```ts
// agent.ts — a conversation that streams.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import OpenAI from "openai";

const client = new OpenAI();
const MODEL = process.env.MODEL ?? "gpt-4o";

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: "You are a blunt, curious assistant. Keep answers short." },
];

const rl = readline.createInterface({ input: stdin, output: stdout });

while (true) {
  let line: string;
  try {
    line = (await rl.question("\n› ")).trim();
  } catch {
    break;                    // Ctrl+D closes the input stream
  }
  if (!line) continue;
  if (line === "/exit") break;

  messages.push({ role: "user", content: line });

  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    stream: true,
  });

  let text = "";
  stdout.write("\n");
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) continue;
    text += delta;
    stdout.write(delta);
  }
  console.log();

  messages.push({ role: "assistant", content: text });
}

rl.close();
```

Run it:

```bash
npm run dev
```

Type something. Watch the answer arrive a piece at a time.

---

## What each part is doing

### The message array is the entire state

```ts
const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: "..." },
];
```

There is no session object, no conversation ID, no server-side thread. **The
model is stateless.** Every request sends the whole conversation again, and the
only reason the model appears to remember the last thing you said is that you
put it back in the array.

This is the single most important idea in the course, and it is worth stopping
on. Everything later in this project — memory on disk, four practitioners
sharing a transcript — is a consequence of it. If the model remembered things
by itself, none of it would need to exist.

Note the two `push` calls, and where they are:

```ts
messages.push({ role: "user", content: line });      // before the request
...
messages.push({ role: "assistant", content: text }); // after the response
```

Forget the second one and the model will answer your first question forever,
because from its point of view it never replied.

### Streaming is a loop over chunks

```ts
const stream = await client.chat.completions.create({ model: MODEL, messages, stream: true });

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (!delta) continue;
  text += delta;
  stdout.write(delta);
}
```

With `stream: true` the SDK returns an async iterable. Each `chunk` carries a
**delta** — the new characters since the last chunk, not the whole message so
far. So there are two things to do with every delta and you must do both:
write it to the screen, and append it to `text` so you can put the complete
reply into `messages` at the end.

`chunk.choices[0]?.delta?.content` is optional-chained the whole way down
because chunks arrive that carry no content at all — the first one usually only
announces the role, and later in this course chunks will carry tool-call
fragments instead of text. `if (!delta) continue` is not defensive
programming for its own sake; those empty chunks are normal traffic.

`stdout.write` rather than `console.log`, because `console.log` appends a
newline and you would get one character per line.

### Why streaming at all

Time-to-first-token is what the user experiences as speed. A non-streamed reply
that takes four seconds feels broken; the same four seconds with text moving
feels fast. It also means you can *interrupt*, which is session 3, and which
turns out to be a much bigger deal than it sounds.

### `rl.question` throws at end of input

```ts
try {
  line = (await rl.question("\n› ")).trim();
} catch {
  break;                    // Ctrl+D closes the input stream
}
```

When the user presses Ctrl+D, or when the program is fed from a pipe and the
input runs out, readline closes and the pending `question` rejects with
`ERR_USE_AFTER_CLOSE`. Without the `try` your program dies with a stack trace
instead of exiting.

Try it: `echo "hello" | npm run dev`. That pipe is also how you will smoke-test
this thing later, so it is worth having working now.

---

## Exercises

1. Set `stream: false` and read `completion.choices[0].message.content`
   instead. Compare how the two *feel*. Keep the streaming version.
2. Print `chunk` itself for one turn. Look at how many chunks carry no text.
3. Comment out the `assistant` push and have a three-turn conversation. The
   failure is more instructive than the explanation.

---

**Next:** [Session 2 — Memory and tools](02-memory-and-tools.md), where the
agent gets a character, a set of tools, and a memory that survives quitting.
