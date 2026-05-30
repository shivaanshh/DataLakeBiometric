import { useTensorflowModel } from 'react-native-fast-tflite';
import { useFrameProcessor }  from 'react-native-vision-camera';
import { useRunOnJS }         from 'react-native-worklets-core';

export type Landmark = [number, number, number]; // [x, y, z] normalized 0–1

export interface DetectResult {
  landmarks:  Landmark[];    // 468 FaceMesh points ([] when FaceMesh unavailable)
  embedding:  Float32Array;  // 128-D L2-normalized MobileFaceNet output
  faceRGBA:   Uint8Array;    // cropped face in RGBA
  faceWidth:  number;
  faceHeight: number;
}

// ── Model dimensions ──────────────────────────────────────────────────────────
const BLZ = 128;   // BlazeFace input: 128×128
const MSH = 192;   // FaceMesh input:  192×192
const MFN = 112;   // MobileFaceNet:   112×112

// ── BlazeFace SSD anchors (896 total) ─────────────────────────────────────────
const N_ANCHORS   = 896;
const SCORE_THRESH = 0.60;
const FACE_PADDING = 0.15;

function buildAnchors(): Float32Array {
  const a = new Float32Array(N_ANCHORS * 2);
  let i = 0;
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) for (let k = 0; k < 2; k++) {
    a[i++] = (c + 0.5) / 16; a[i++] = (r + 0.5) / 16;
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (let k = 0; k < 6; k++) {
    a[i++] = (c + 0.5) / 8; a[i++] = (r + 0.5) / 8;
  }
  return a;
}
const ANCHORS = buildAnchors();

// ── Worklet helpers ───────────────────────────────────────────────────────────

function toBlazeFaceInput(src: Uint8Array, W: number, H: number): Float32Array {
  'worklet';
  const out = new Float32Array(BLZ * BLZ * 3);
  const sx = W / BLZ, sy = H / BLZ;
  let i = 0;
  for (let y = 0; y < BLZ; y++) for (let x = 0; x < BLZ; x++) {
    const s = (Math.floor(y * sy) * W + Math.floor(x * sx)) * 3;
    out[i++] = src[s]     / 127.5 - 1;
    out[i++] = src[s + 1] / 127.5 - 1;
    out[i++] = src[s + 2] / 127.5 - 1;
  }
  return out;
}

function decodeBestBox(
  scores: Float32Array, regs: Float32Array, anch: Float32Array,
): { x1: number; y1: number; x2: number; y2: number } | null {
  'worklet';
  let best = -1, top = SCORE_THRESH;
  for (let i = 0; i < N_ANCHORS; i++) if (scores[i] > top) { top = scores[i]; best = i; }
  if (best < 0) return null;
  const ax = anch[best * 2], ay = anch[best * 2 + 1];
  const cx = regs[best * 16]     / BLZ + ax;
  const cy = regs[best * 16 + 1] / BLZ + ay;
  const hw = regs[best * 16 + 2] / BLZ / 2;
  const hh = regs[best * 16 + 3] / BLZ / 2;
  return { x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh };
}

function cropToRGBA(
  src: Uint8Array, W: number, H: number,
  x1: number, y1: number, x2: number, y2: number,
): { rgba: Uint8Array; cW: number; cH: number } {
  'worklet';
  const p  = FACE_PADDING;
  const px1 = Math.max(0, Math.floor((x1 - p) * W));
  const py1 = Math.max(0, Math.floor((y1 - p) * H));
  const px2 = Math.min(W - 1, Math.ceil((x2 + p) * W));
  const py2 = Math.min(H - 1, Math.ceil((y2 + p) * H));
  const cW = px2 - px1, cH = py2 - py1;
  const rgba = new Uint8Array(cW * cH * 4);
  for (let row = 0; row < cH; row++) for (let col = 0; col < cW; col++) {
    const s = ((py1 + row) * W + (px1 + col)) * 3; // pixelFormat=rgb
    const d = (row * cW + col) * 4;
    rgba[d] = src[s]; rgba[d+1] = src[s+1]; rgba[d+2] = src[s+2]; rgba[d+3] = 255;
  }
  return { rgba, cW, cH };
}

function toMeshInput(rgba: Uint8Array, cW: number, cH: number): Float32Array {
  'worklet';
  const out = new Float32Array(MSH * MSH * 3);
  const sx = cW / MSH, sy = cH / MSH;
  let i = 0;
  for (let y = 0; y < MSH; y++) for (let x = 0; x < MSH; x++) {
    const s = (Math.floor(y * sy) * cW + Math.floor(x * sx)) * 4;
    out[i++] = rgba[s] / 255; out[i++] = rgba[s+1] / 255; out[i++] = rgba[s+2] / 255;
  }
  return out;
}

function parseLandmarks(raw: Float32Array): Landmark[] {
  'worklet';
  const lms: Landmark[] = [];
  for (let i = 0; i < 468; i++) lms.push([raw[i*3]/MSH, raw[i*3+1]/MSH, raw[i*3+2]/MSH]);
  return lms;
}

function toMFNInput(rgba: Uint8Array, cW: number, cH: number): Float32Array {
  'worklet';
  const out = new Float32Array(MFN * MFN * 3);
  const sx = cW / MFN, sy = cH / MFN;
  let i = 0;
  for (let y = 0; y < MFN; y++) for (let x = 0; x < MFN; x++) {
    const s = (Math.floor(y * sy) * cW + Math.floor(x * sx)) * 4;
    out[i++] = (rgba[s]     - 127.5) / 128;
    out[i++] = (rgba[s + 1] - 127.5) / 128;
    out[i++] = (rgba[s + 2] - 127.5) / 128;
  }
  return out;
}

function l2Normalize(v: Float32Array): Float32Array {
  'worklet';
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) + 1e-10;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDetectAndMesh(onResult: (r: DetectResult | null) => void) {
  const blaze = useTensorflowModel(require('../../models/blazeface.tflite'));
  const mesh  = useTensorflowModel(require('../../models/facemesh.tflite'));
  const mfn   = useTensorflowModel(require('../../models/mobilefacenet_int8.tflite'));

  const notify = useRunOnJS(onResult, [onResult]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (blaze.state !== 'loaded' || !blaze.model) return;
    if (mfn.state   !== 'loaded' || !mfn.model)   return;

    const W   = frame.width;
    const H   = frame.height;
    const src = new Uint8Array(frame.toArrayBuffer());

    // Stage 1 — face detection
    const blazeOut = blaze.model.runSync([toBlazeFaceInput(src, W, H)]) as Float32Array[];
    const box      = decodeBestBox(blazeOut[0], blazeOut[1], ANCHORS);
    if (!box) { notify(null); return; }

    const { rgba, cW, cH } = cropToRGBA(src, W, H, box.x1, box.y1, box.x2, box.y2);

    // Stage 2 — landmarks (optional)
    let landmarks: Landmark[] = [];
    if (mesh.state === 'loaded' && mesh.model) {
      const meshOut = mesh.model.runSync([toMeshInput(rgba, cW, cH)]) as Float32Array[];
      if (meshOut[0]?.length >= 468 * 3) landmarks = parseLandmarks(meshOut[0]);
    }

    // Stage 3 — face embedding
    const mfnOut   = mfn.model.runSync([toMFNInput(rgba, cW, cH)]) as Float32Array[];
    const embedding = l2Normalize(mfnOut[0] as Float32Array);

    notify({ landmarks, embedding, faceRGBA: rgba, faceWidth: cW, faceHeight: cH });
  }, [blaze, mesh, mfn, notify]);

  const isLoading = blaze.state !== 'loaded' || mfn.state !== 'loaded';
  return { frameProcessor, isLoading };
}
