/**
 * imageProcessor.ts
 *
 * Image preprocessing utilities for improving face detection
 * in adverse outdoor lighting conditions (harsh sunlight, shadows, glare).
 *
 * Key technique: CLAHE (Contrast-Limited Adaptive Histogram Equalization)
 *   - Divides image into 8×8 tiles
 *   - Applies histogram equalization per tile with a clip limit
 *   - Dramatically improves face visibility in Indian outdoor conditions
 *
 * Note: Full CLAHE is implemented in the native layer (OpenCV on Android/iOS)
 * for performance. This file provides the JS-side preprocessing helpers
 * and a pure-JS fallback CLAHE for testing.
 */

// ─── Types ─────────────────────────────────────────────────────────────────
export interface ImageData {
  data:   Uint8Array; // RGBA pixel data
  width:  number;
  height: number;
}

// ─── Gamma Correction ──────────────────────────────────────────────────────
/**
 * Apply gamma correction to brighten underexposed faces (low-light).
 * gamma < 1 → brighter, gamma > 1 → darker
 */
export function applyGamma(image: ImageData, gamma: number = 0.8): ImageData {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.min(255, Math.round(255 * (i / 255) ** gamma));
  }

  const out = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    out[i]     = lut[image.data[i]];     // R
    out[i + 1] = lut[image.data[i + 1]]; // G
    out[i + 2] = lut[image.data[i + 2]]; // B
    out[i + 3] = image.data[i + 3];      // A unchanged
  }
  return { data: out, width: image.width, height: image.height };
}

// ─── Grayscale Conversion ──────────────────────────────────────────────────
export function toGrayscale(image: ImageData): Uint8Array {
  const gray = new Uint8Array(image.width * image.height);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j++) {
    // BT.601 luma coefficients
    gray[j] = Math.round(0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]);
  }
  return gray;
}

// ─── Pure-JS CLAHE Fallback ────────────────────────────────────────────────
/**
 * Contrast-Limited Adaptive Histogram Equalization (pure JS fallback).
 *
 * Use for testing only. In production, this is called via native module
 * (OpenCV CLAHE) which is ~10× faster.
 *
 * @param gray      Uint8Array of grayscale pixel values
 * @param width     Image width
 * @param height    Image height
 * @param tileSize  Tile size in pixels (default 8)
 * @param clipLimit Contrast clip limit 0–255 (default 40)
 */
export function clahe(
  gray: Uint8Array,
  width: number,
  height: number,
  tileSize: number = 8,
  clipLimit: number = 40
): Uint8Array {
  const output    = new Uint8Array(gray.length);
  const tilesX    = Math.ceil(width  / tileSize);
  const tilesY    = Math.ceil(height / tileSize);

  // Pre-compute CLHE lookup table for each tile
  const luts: Uint8Array[][] = Array.from({ length: tilesY }, () =>
    Array.from({ length: tilesX }, () => new Uint8Array(256))
  );

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const hist = new Int32Array(256);
      let   count = 0;

      for (let y = ty * tileSize; y < Math.min((ty + 1) * tileSize, height); y++) {
        for (let x = tx * tileSize; x < Math.min((tx + 1) * tileSize, width); x++) {
          hist[gray[y * width + x]]++;
          count++;
        }
      }

      // Clip histogram
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clipLimit) {
          excess += hist[i] - clipLimit;
          hist[i] = clipLimit;
        }
      }

      // Redistribute excess uniformly
      const redistPerBin = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) hist[i] += redistPerBin;

      // Build CDF → LUT
      let cdf = 0;
      for (let i = 0; i < 256; i++) {
        cdf += hist[i];
        luts[ty][tx][i] = Math.round((cdf / count) * 255);
      }
    }
  }

  // Bilinear interpolation between tile LUTs
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = gray[y * width + x];
      const tx  = Math.min((x / tileSize) - 0.5, tilesX - 1);
      const ty  = Math.min((y / tileSize) - 0.5, tilesY - 1);
      const tx0 = Math.max(0, Math.floor(tx));
      const ty0 = Math.max(0, Math.floor(ty));
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty1 = Math.min(tilesY - 1, ty0 + 1);
      const dx  = tx - tx0;
      const dy  = ty - ty0;

      const v00 = luts[ty0][tx0][val];
      const v10 = luts[ty0][tx1][val];
      const v01 = luts[ty1][tx0][val];
      const v11 = luts[ty1][tx1][val];

      output[y * width + x] = Math.round(
        v00 * (1 - dx) * (1 - dy) +
        v10 * dx * (1 - dy) +
        v01 * (1 - dx) * dy +
        v11 * dx * dy
      );
    }
  }

  return output;
}

// ─── Adaptive Preprocessing ────────────────────────────────────────────────
/**
 * Detects mean brightness and applies either CLAHE (dark) or gamma (bright).
 * This adaptive step handles the full range of Indian outdoor conditions.
 */
export function adaptivePreprocess(image: ImageData): ImageData {
  const gray = toGrayscale(image);
  const mean = gray.reduce((sum, v) => sum + v, 0) / gray.length;

  // Too dark → apply brightening gamma
  if (mean < 80) {
    return applyGamma(image, 0.6);
  }

  // Too bright (overexposed) → darken slightly
  if (mean > 200) {
    return applyGamma(image, 1.4);
  }

  // Moderate → CLAHE for local contrast enhancement
  const enhanced = clahe(gray, image.width, image.height);
  const out      = new Uint8Array(image.data.length);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j++) {
    out[i]     = enhanced[j];
    out[i + 1] = enhanced[j];
    out[i + 2] = enhanced[j];
    out[i + 3] = image.data[i + 3];
  }
  return { data: out, width: image.width, height: image.height };
}
