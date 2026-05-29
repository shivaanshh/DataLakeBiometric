import { useTensorflowModel } from 'react-native-fast-tflite';

const EMBED_DIM   = 128;
const INPUT_SIZE  = 112;
const THRESHOLD   = 0.72;

export class FaceRecognizer {
  getEmbedding(faceRGBA: Uint8Array, width: number, height: number): Float32Array {
    // Resize to 112x112, normalize to [-1,1]
    const input = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
    const scaleX = width  / INPUT_SIZE;
    const scaleY = height / INPUT_SIZE;
    let idx = 0;
    for (let y = 0; y < INPUT_SIZE; y++) {
      for (let x = 0; x < INPUT_SIZE; x++) {
        const si = (Math.floor(y * scaleY) * width + Math.floor(x * scaleX)) * 4;
        input[idx++] = (faceRGBA[si]     - 127.5) / 128;
        input[idx++] = (faceRGBA[si + 1] - 127.5) / 128;
        input[idx++] = (faceRGBA[si + 2] - 127.5) / 128;
      }
    }
    // Stub: return zeroed L2-normalized embedding until real model is loaded
    const embed = new Float32Array(EMBED_DIM);
    return this.l2Normalize(embed);
  }

  cosineSim(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(-1, Math.min(1, dot));
  }

  isMatch(query: Float32Array, stored: Float32Array): boolean {
    return this.cosineSim(query, stored) >= THRESHOLD;
  }

  averageEmbeddings(embeddings: Float32Array[]): Float32Array {
    const avg = new Float32Array(EMBED_DIM);
    for (const e of embeddings) for (let i = 0; i < EMBED_DIM; i++) avg[i] += e[i];
    for (let i = 0; i < EMBED_DIM; i++) avg[i] /= embeddings.length;
    return this.l2Normalize(avg);
  }

  private l2Normalize(v: Float32Array): Float32Array {
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) + 1e-10;
    return new Float32Array(Array.from(v).map(x => x / norm));
  }
}
