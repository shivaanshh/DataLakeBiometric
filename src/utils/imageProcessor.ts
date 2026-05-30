// Image preprocessing utilities (gamma, grayscale, CLAHE).
// Currently unused at runtime — preprocessing is done inside the
// frame processor worklet in src/plugins/useDetectAndMesh.ts.

export interface ImageData {
  data:   Uint8Array;
  width:  number;
  height: number;
}

export function toGrayscale(img: ImageData): Uint8Array {
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * img.data[i] + 0.587 * img.data[i+1] + 0.114 * img.data[i+2]);
  }
  return gray;
}

export function applyGamma(img: ImageData, gamma = 0.8): ImageData {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.min(255, Math.round(255 * (i / 255) ** gamma));
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    out[i] = lut[img.data[i]]; out[i+1] = lut[img.data[i+1]];
    out[i+2] = lut[img.data[i+2]]; out[i+3] = img.data[i+3];
  }
  return { data: out, width: img.width, height: img.height };
}
