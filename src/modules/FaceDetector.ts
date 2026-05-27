/**
 * FaceDetector.ts
 *
 * Wrapper around BlazeFace TFLite model.
 * Detects face bounding boxes in a camera frame.
 *
 * Model input:  128 × 128 RGB (short-range model)
 * Model output: [x1, y1, x2, y2, score] per detection
 *
 * TODO for Claude Code:
 *   - Implement loadTensorflowModel() call with actual path
 *   - Wire up frame processor plugin in native layer
 *   - Verify output tensor shape for your specific blazeface variant
 */

const BLAZEFACE_INPUT_SIZE  = 128;
const DETECTION_THRESHOLD   = 0.75;

export interface FaceBox {
  x1: number; // normalized 0–1
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

export class FaceDetector {
  private model: any = null;

  async initialize(): Promise<void> {
    /**
     * TODO: Uncomment when TFLite bridge is ready.
     *
     * this.model = await loadTensorflowModel(
     *   require('../../../models/blazeface.tflite'),
     *   { numThreads: 1, useXNNPackDelegate: true }
     * );
     */
    console.log('[FaceDetector] BlazeFace initialized (stub).');
  }

  /**
   * Detect faces in a raw RGBA frame.
   * Returns the highest-confidence face box, or null if none found.
   */
  async detect(rgba: Uint8Array, width: number, height: number): Promise<FaceBox | null> {
    const input = this.preprocessFrame(rgba, width, height);

    /**
     * TODO: Replace with actual inference:
     *
     * const [boxes, scores] = await this.model.run([input]);
     * return this.selectBestFace(boxes as Float32Array, scores as Float32Array);
     */

    // Stub: assume a centered face for testing
    return { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9, score: 0.99 };
  }

  /** Resize + normalize frame for BlazeFace input */
  private preprocessFrame(rgba: Uint8Array, srcW: number, srcH: number): Float32Array {
    const dst   = BLAZEFACE_INPUT_SIZE;
    const out   = new Float32Array(dst * dst * 3);
    const scaleX = srcW / dst;
    const scaleY = srcH / dst;

    let idx = 0;
    for (let y = 0; y < dst; y++) {
      for (let x = 0; x < dst; x++) {
        const sx = Math.floor(x * scaleX);
        const sy = Math.floor(y * scaleY);
        const si = (sy * srcW + sx) * 4;
        out[idx++] = rgba[si]     / 255.0; // R
        out[idx++] = rgba[si + 1] / 255.0; // G
        out[idx++] = rgba[si + 2] / 255.0; // B
      }
    }
    return out;
  }

  private selectBestFace(boxes: Float32Array, scores: Float32Array): FaceBox | null {
    let bestIdx   = -1;
    let bestScore = DETECTION_THRESHOLD;

    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > bestScore) {
        bestScore = scores[i];
        bestIdx   = i;
      }
    }

    if (bestIdx === -1) return null;

    const b = bestIdx * 4;
    return {
      x1:    boxes[b],
      y1:    boxes[b + 1],
      x2:    boxes[b + 2],
      y2:    boxes[b + 3],
      score: bestScore,
    };
  }

  /**
   * Crop the detected face region from an RGBA frame.
   * Returns raw RGBA pixel data of the cropped region.
   */
  cropFace(
    rgba: Uint8Array,
    width: number,
    height: number,
    box: FaceBox,
    padding: number = 0.1 // 10% padding around face
  ): { data: Uint8Array; width: number; height: number } {
    const x1 = Math.max(0, Math.floor((box.x1 - padding) * width));
    const y1 = Math.max(0, Math.floor((box.y1 - padding) * height));
    const x2 = Math.min(width  - 1, Math.ceil((box.x2 + padding) * width));
    const y2 = Math.min(height - 1, Math.ceil((box.y2 + padding) * height));
    const w  = x2 - x1;
    const h  = y2 - y1;

    const crop = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) {
      const srcOffset = ((y1 + row) * width + x1) * 4;
      const dstOffset = row * w * 4;
      crop.set(rgba.subarray(srcOffset, srcOffset + w * 4), dstOffset);
    }

    return { data: crop, width: w, height: h };
  }
}
