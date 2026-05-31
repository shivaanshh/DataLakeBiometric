import { useTensorflowModel } from 'react-native-fast-tflite';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { Landmark } from '../modules/LivenessChecker';

export interface DetectResult {
  embedding: Float32Array;
  landmarks: Landmark[];
  faceFound: boolean;
}

// ── BlazeFace SSD anchors ─────────────────────────────────────────────────────

interface Anchor { cx: number; cy: number; }

function buildAnchors(): Anchor[] {
  'worklet';
  const anchors: Anchor[] = [];
  // 16×16 grid, 2 anchors each = 512
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      for (let a = 0; a < 2; a++) {
        anchors.push({ cx: (x + 0.5) / 16, cy: (y + 0.5) / 16 });
      }
    }
  }
  // 8×8 grid, 6 anchors each = 384
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      for (let a = 0; a < 6; a++) {
        anchors.push({ cx: (x + 0.5) / 8, cy: (y + 0.5) / 8 });
      }
    }
  }
  return anchors;
}

const ANCHORS_DATA = buildAnchors();
const SCORE_THRESH = 0.60;

interface Box { x1: number; y1: number; x2: number; y2: number; score: number; }

function sigmoid(x: number): number {
  'worklet';
  return 1 / (1 + Math.exp(-x));
}

function decodeBestBox(scores: Float32Array, boxes: Float32Array): Box | null {
  'worklet';
  let bestScore = SCORE_THRESH;
  let bestIdx = -1;
  for (let i = 0; i < 896; i++) {
    const s = sigmoid(scores[i]);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  if (bestIdx === -1) return null;

  const anchor = ANCHORS_DATA[bestIdx];
  const base = bestIdx * 16;
  const cx = boxes[base + 0] / 128 + anchor.cx;
  const cy = boxes[base + 1] / 128 + anchor.cy;
  const w  = boxes[base + 2] / 128;
  const h  = boxes[base + 3] / 128;

  return {
    x1: Math.max(0, cx - w / 2),
    y1: Math.max(0, cy - h / 2),
    x2: Math.min(1, cx + w / 2),
    y2: Math.min(1, cy + h / 2),
    score: bestScore,
  };
}

// ── pixel helpers ─────────────────────────────────────────────────────────────

function resizeAndNormalizeRGB(
  src: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number,
  mean: number, std: number,
): Float32Array {
  'worklet';
  const out = new Float32Array(dstW * dstH * 3);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * scaleX));
      const sy = Math.min(srcH - 1, Math.floor(y * scaleY));
      const si = (sy * srcW + sx) * 3;
      const di = (y * dstW + x) * 3;
      out[di]     = (src[si]     - mean) / std;
      out[di + 1] = (src[si + 1] - mean) / std;
      out[di + 2] = (src[si + 2] - mean) / std;
    }
  }
  return out;
}

function cropFace(
  src: Uint8Array, srcW: number, srcH: number,
  box: Box, padding: number,
  dstW: number, dstH: number,
  mean: number, std: number,
): Float32Array {
  'worklet';
  const pw = (box.x2 - box.x1) * padding;
  const ph = (box.y2 - box.y1) * padding;
  const x1 = Math.max(0, box.x1 - pw);
  const y1 = Math.max(0, box.y1 - ph);
  const x2 = Math.min(1, box.x2 + pw);
  const y2 = Math.min(1, box.y2 + ph);

  const cropW = Math.max(1, Math.round((x2 - x1) * srcW));
  const cropH = Math.max(1, Math.round((y2 - y1) * srcH));
  const offX = Math.round(x1 * srcW);
  const offY = Math.round(y1 * srcH);

  const out = new Float32Array(dstW * dstH * 3);
  const scaleX = cropW / dstW;
  const scaleY = cropH / dstH;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, offX + Math.floor(x * scaleX));
      const sy = Math.min(srcH - 1, offY + Math.floor(y * scaleY));
      const si = (sy * srcW + sx) * 3;
      const di = (y * dstW + x) * 3;
      out[di]     = (src[si]     - mean) / std;
      out[di + 1] = (src[si + 1] - mean) / std;
      out[di + 2] = (src[si + 2] - mean) / std;
    }
  }
  return out;
}

function l2NormalizeWorklet(v: Float32Array): Float32Array {
  'worklet';
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function parseLandmarks(raw: Float32Array): Landmark[] {
  'worklet';
  const pts: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    pts.push({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] });
  }
  return pts;
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useDetectAndMesh(onDetect: (result: DetectResult | null) => void) {
  const blaze = useTensorflowModel(require('../../models/blazeface.tflite'));
  const mesh  = useTensorflowModel(require('../../models/facemesh.tflite'));
  const mfn   = useTensorflowModel(require('../../models/mobilefacenet_int8.tflite'));

  const isLoading = blaze.state !== 'loaded' || mfn.state !== 'loaded';

  const notifyJS = useRunOnJS((result: DetectResult | null) => {
    onDetect(result);
  }, [onDetect]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!blaze.model || !mfn.model) return;

    const buf = frame.toArrayBuffer();
    const pixels = new Uint8Array(buf);
    const W = frame.width;
    const H = frame.height;

    // 1. BlazeFace — 128×128, normalized to [-1, 1]
    const blazeInput = resizeAndNormalizeRGB(pixels, W, H, 128, 128, 128, 128);
    const [blazeScores, blazeBoxes] = blaze.model.runSync([blazeInput]) as [Float32Array, Float32Array];
    const box = decodeBestBox(blazeScores, blazeBoxes);

    if (!box) {
      notifyJS(null);
      return;
    }

    // 2. MobileFaceNet — 112×112 crop, normalized to [-1, 1]
    const mfnInput = cropFace(pixels, W, H, box, 0.15, 112, 112, 128, 128);
    const [rawEmbedding] = mfn.model.runSync([mfnInput]) as [Float32Array];
    const embedding = l2NormalizeWorklet(rawEmbedding);

    // 3. FaceMesh — 192×192 crop, normalized to [0, 1] (optional)
    let landmarks: Landmark[] = [];
    if (mesh.model) {
      const meshInput = cropFace(pixels, W, H, box, 0.15, 192, 192, 0, 255);
      const [rawLandmarks] = mesh.model.runSync([meshInput]) as [Float32Array];
      landmarks = parseLandmarks(rawLandmarks);
    }

    notifyJS({ embedding, landmarks, faceFound: true });
  }, [blaze.model, mesh.model, mfn.model, notifyJS]);

  return { frameProcessor, isLoading };
}
