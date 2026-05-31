export const MATCH_THRESHOLD = 0.40;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) throw new Error('No embeddings to average');
  const len = embeddings[0].length;
  const avg = new Float32Array(len);
  for (const e of embeddings) {
    for (let i = 0; i < len; i++) avg[i] += e[i];
  }
  for (let i = 0; i < len; i++) avg[i] /= embeddings.length;
  return l2Normalize(avg);
}

export function isMatch(query: Float32Array, enrolled: Float32Array): boolean {
  return cosineSimilarity(query, enrolled) >= MATCH_THRESHOLD;
}
