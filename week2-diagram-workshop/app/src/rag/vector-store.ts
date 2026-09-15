import { Index } from "@upstash/vector";

// One place that knows how to reach the vector index.
//
// Upstash embeds for us: we send text, it runs the embedding model server-side
// and stores the vector. That removes a whole moving part from the workshop —
// no embedding API call of our own, no dimension mismatch, no vector maths.
// The ideas are identical to a local store: chunk, embed, upsert, query by
// cosine similarity, take the top K.
export interface VectorEnv {
  UPSTASH_VECTOR_REST_URL?: string;
  UPSTASH_VECTOR_REST_TOKEN?: string;
}

export function getIndex(env: VectorEnv): Index {
  if (!env.UPSTASH_VECTOR_REST_URL || !env.UPSTASH_VECTOR_REST_TOKEN) {
    throw new Error("Upstash Vector is not configured");
  }
  return new Index({
    url: env.UPSTASH_VECTOR_REST_URL,
    token: env.UPSTASH_VECTOR_REST_TOKEN,
  });
}
