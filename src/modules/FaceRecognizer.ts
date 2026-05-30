const DIM = 128;

// Threshold for placeholder model (real MobileFaceNet uses 0.72)
export const SIMILARITY_THRESHOLD = 0.40;

export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

export function isMatch(query: Float32Array, stored: Float32Array): boolean {
  return cosineSim(query, stored) >= SIMILARITY_THRESHOLD;
}

export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  const avg = new Float32Array(DIM);
  for (const e of embeddings) for (let i = 0; i < DIM; i++) avg[i] += e[i];
  for (let i = 0; i < DIM; i++) avg[i] /= embeddings.length;
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm) + 1e-10;
  for (let i = 0; i < DIM; i++) avg[i] /= norm;
  return avg;
}
