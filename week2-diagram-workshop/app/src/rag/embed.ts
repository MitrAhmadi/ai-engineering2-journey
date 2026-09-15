// Load the corpus into the vector index. Run it once, and again whenever the
// files under corpus/ change:
//
//   npm run embed
//
// Three steps, and they are the whole of RAG's write path:
//   read the documents → cut them into chunks → upsert each chunk
//
// The chunking here is deliberately dumb: split on blank lines, then glue the
// small pieces back together until each chunk is a few hundred characters. For
// short reference docs that is enough, and it keeps the interesting decision
// visible rather than hidden in a library. The interesting decision is: a chunk
// should be the smallest thing that still makes sense on its own. Too small and
// you retrieve a fragment with no context; too big and you spend the model's
// attention on paragraphs nobody asked for.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getIndex } from "./vector-store";

const TARGET = 700; // characters per chunk, roughly

function chunk(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > TARGET) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

const index = getIndex({
  UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL,
  UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

const files = readdirSync("corpus").filter((f) => f.endsWith(".md"));
let total = 0;

for (const file of files) {
  const text = readFileSync(join("corpus", file), "utf8");
  // Keep the document's title on every chunk from it. A chunk that starts
  // "3. The user authenticates…" is nearly useless on its own; the same chunk
  // under "# OAuth 2.0 authorization code flow" is retrievable and readable.
  const title = text.split("\n")[0]?.replace(/^#\s*/, "") ?? file;
  const pieces = chunk(text);

  for (const [i, content] of pieces.entries()) {
    const body = `${title}\n\n${content}`;
    await index.upsert({
      id: `${file}#${i}`,
      // Upstash embeds this text for us — no embedding call of our own.
      data: body,
      // …but it does not hand the text back on query, only metadata. So we
      // store a copy here, which is what searchKnowledge returns to the model.
      metadata: { source: file, content: body },
    });
    total++;
  }
  console.log(`  ${file}: ${pieces.length} chunk(s)`);
}

console.log(`\n  ${total} chunks upserted from ${files.length} file(s)\n`);
