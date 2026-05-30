import { useTensorflowModel }  from 'react-native-fast-tflite';
import { useFrameProcessor }   from 'react-native-vision-camera';
import { useRunOnJS }          from 'react-native-worklets-core';
import type { Landmark }       from '../modules/LivenessChecker';

export interface DetectResult {
  landmarks:  Landmark[];   // 468 FaceMesh points (empty if mesh model unavailable)
  embedding:  Float32Array; // 128-D L2-normalized MobileFaceNet embedding
  faceRGBA:   Uint8Array;
  faceWidth:  number;
  faceHeight: number;
}

const BLAZE_IN  = 128;
const MESH_IN   = 192;
const MFN_IN    = 112;
const ANCHORS   = 896;
const SCORE_THR = 0.60;
const FACE_PAD  = 0.15;

// BlazeFace short-range SSD anchor grid
function makeAnchors(): Float32Array {
  const a = new Float32Array(ANCHORS * 2);
  let i = 0;
  // 16×16 grid, 2 anchors per cell → 512
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) for (let k = 0; k < 2; k++) {
    a[i++] = (c + 0.5) / 16;
    a[i++] = (r + 0.5) / 16;
  }
  // 8×8 grid, 6 anchors per cell → 384
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (let k = 0; k < 6; k++) {
    a[i++] = (c + 0.5) / 8;
    a[i++] = (r + 0.5) / 8;
  }
  return a;
}
const ANCHORS_DATA = makeAnchors();

// ── Worklet helpers ──────────────────────────────────────────────────────────

function blazeInput(src: Uint8Array, W: number, H: number): Float32Array {
  'worklet';
  const out = new Float32Array(BLAZE_IN * BLAZE_IN * 3);
  const sx = W / BLAZE_IN, sy = H / BLAZE_IN;
  let i = 0;
  for (let y = 0; y < BLAZE_IN; y++) for (let x = 0; x < BLAZE_IN; x++) {
    const si = (Math.floor(y * sy) * W + Math.floor(x * sx)) * 3; // pixelFormat=rgb
    out[i++] = (src[si]     / 127.5) - 1;
    out[i++] = (src[si + 1] / 127.5) - 1;
    out[i++] = (src[si + 2] / 127.5) - 1;
  }
  return out;
}

function decodeFace(
  scores: Float32Array, regs: Float32Array, anchors: Float32Array,
): { x1: number; y1: number; x2: number; y2: number } | null {
  'worklet';
  let best = -1, bestS = SCORE_THR;
  for (let i = 0; i < ANCHORS; i++) {
    if (scores[i] > bestS) { bestS = scores[i]; best = i; }
  }
  if (best < 0) return null;
  const ax = anchors[best * 2], ay = anchors[best * 2 + 1];
  const cx = regs[best * 16]     / BLAZE_IN + ax;
  const cy = regs[best * 16 + 1] / BLAZE_IN + ay;
  const hw = regs[best * 16 + 2] / BLAZE_IN / 2;
  const hh = regs[best * 16 + 3] / BLAZE_IN / 2;
  return { x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh };
}

function cropFace(
  src: Uint8Array, W: number, H: number,
  x1: number, y1: number, x2: number, y2: number,
): { rgba: Uint8Array; cW: number; cH: number } {
  'worklet';
  const px1 = Math.max(0, Math.floor((x1 - FACE_PAD) * W));
  const py1 = Math.max(0, Math.floor((y1 - FACE_PAD) * H));
  const px2 = Math.min(W - 1, Math.ceil((x2 + FACE_PAD) * W));
  const py2 = Math.min(H - 1, Math.ceil((y2 + FACE_PAD) * H));
  const cW  = px2 - px1, cH = py2 - py1;
  const rgba = new Uint8Array(cW * cH * 4);
  for (let row = 0; row < cH; row++) for (let col = 0; col < cW; col++) {
    const si = ((py1 + row) * W + (px1 + col)) * 3;
    const di = (row * cW + col) * 4;
    rgba[di] = src[si]; rgba[di+1] = src[si+1]; rgba[di+2] = src[si+2]; rgba[di+3] = 255;
  }
  return { rgba, cW, cH };
}

function meshInput(rgba: Uint8Array, cW: number, cH: number): Float32Array {
  'worklet';
  const out = new Float32Array(MESH_IN * MESH_IN * 3);
  const sx = cW / MESH_IN, sy = cH / MESH_IN;
  let i = 0;
  for (let y = 0; y < MESH_IN; y++) for (let x = 0; x < MESH_IN; x++) {
    const si = (Math.floor(y * sy) * cW + Math.floor(x * sx)) * 4;
    out[i++] = rgba[si]     / 255;
    out[i++] = rgba[si + 1] / 255;
    out[i++] = rgba[si + 2] / 255;
  }
  return out;
}

function parseLandmarks(raw: Float32Array): Landmark[] {
  'worklet';
  const lms: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    lms.push([raw[i*3] / MESH_IN, raw[i*3+1] / MESH_IN, raw[i*3+2] / MESH_IN]);
  }
  return lms;
}

function mfnInput(rgba: Uint8Array, cW: number, cH: number): Float32Array {
  'worklet';
  const out = new Float32Array(MFN_IN * MFN_IN * 3);
  const sx = cW / MFN_IN, sy = cH / MFN_IN;
  let i = 0;
  for (let y = 0; y < MFN_IN; y++) for (let x = 0; x < MFN_IN; x++) {
    const si = (Math.floor(y * sy) * cW + Math.floor(x * sx)) * 4;
    out[i++] = (rgba[si]     - 127.5) / 128;
    out[i++] = (rgba[si + 1] - 127.5) / 128;
    out[i++] = (rgba[si + 2] - 127.5) / 128;
  }
  return out;
}

function l2Norm(v: Float32Array): Float32Array {
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

  const cb = useRunOnJS(onResult, [onResult]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // BlazeFace and MobileFaceNet are mandatory
    if (blaze.state !== 'loaded' || !blaze.model) return;
    if (mfn.state   !== 'loaded' || !mfn.model)   return;

    const W   = frame.width;
    const H   = frame.height;
    const src = new Uint8Array(frame.toArrayBuffer());

    // Stage 1: detect face
    const bOut = blaze.model.runSync([blazeInput(src, W, H)]) as Float32Array[];
    const box  = decodeFace(bOut[0], bOut[1], ANCHORS_DATA);
    if (!box) { cb(null); return; }

    // Crop face
    const { rgba, cW, cH } = cropFace(src, W, H, box.x1, box.y1, box.x2, box.y2);

    // Stage 2: FaceMesh landmarks (optional — if model loaded)
    let landmarks: Landmark[] = [];
    if (mesh.state === 'loaded' && mesh.model) {
      const mOut = mesh.model.runSync([meshInput(rgba, cW, cH)]) as Float32Array[];
      if (mOut[0] && mOut[0].length >= 468 * 3) {
        landmarks = parseLandmarks(mOut[0]);
      }
    }

    // Stage 3: MobileFaceNet embedding
    const mfnOut    = mfn.model.runSync([mfnInput(rgba, cW, cH)]) as Float32Array[];
    const embedding = l2Norm(mfnOut[0] as Float32Array);

    cb({ landmarks, embedding, faceRGBA: rgba, faceWidth: cW, faceHeight: cH });
  }, [blaze, mesh, mfn, cb]);

  // Loading until at minimum blaze and mfn are ready
  const isLoading = blaze.state !== 'loaded' || mfn.state !== 'loaded';
  return { frameProcessor, isLoading };
}
