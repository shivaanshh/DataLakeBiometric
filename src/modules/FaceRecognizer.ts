// Cosine similarity threshold for face matching.
// A real pre-trained MobileFaceNet model uses 0.72.
// The placeholder model (random weights) needs a lower value.
export const MATCH_THRESHOLD = 0.40;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

export function isMatch(query: Float32Array, enrolled: Float32Array): boolean {
  return cosineSimilarity(query, enrolled) >= MATCH_THRESHOLD;
}

// Average multiple embeddings and L2-normalize the result.
export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  const dim = embeddings[0].length;
  const avg = new Float32Array(dim);
  for (const e of embeddings) for (let i = 0; i < dim; i++) avg[i] += e[i];
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm) + 1e-10;
  for (let i = 0; i < dim; i++) avg[i] /= norm;
  return avg;
}
