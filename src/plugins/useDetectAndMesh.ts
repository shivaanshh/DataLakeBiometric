import { useTensorflowModel }  from 'react-native-fast-tflite';
import { useFrameProcessor }   from 'react-native-vision-camera';
import { useRunOnJS }           from 'react-native-worklets-core';
import type { Landmark }        from '../modules/LivenessChecker';

export interface DetectResult {
  landmarks:  Landmark[];
  faceRGBA:   Uint8Array;
  faceWidth:  number;
  faceHeight: number;
}

// ── Constants ────────────────────────────────────────────────────────────────
const BLAZE_IN  = 128;
const MESH_IN   = 192;
const ANCHORS   = 896;
const THRESHOLD = 0.65;
const PAD       = 0.12;
const RGB       = 3;
const RGBA      = 4;

// Pre-compute BlazeFace SSD anchors (896 total)
function buildAnchors(): Float32Array {
  const a = new Float32Array(ANCHORS * 2);
  let i = 0;
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) for (let k = 0; k < 2; k++) {
    a[i++] = (c + 0.5) / 16;
    a[i++] = (r + 0.5) / 16;
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (let k = 0; k < 6; k++) {
    a[i++] = (c + 0.5) / 8;
    a[i++] = (r + 0.5) / 8;
  }
  return a;
}
const ANCHOR_DATA = buildAnchors();

// ── Worklet helpers (must carry 'worklet' directive) ─────────────────────────

function blazeInput(src: Uint8Array, W: number, H: number): Float32Array {
  'worklet';
  const out = new Float32Array(BLAZE_IN * BLAZE_IN * 3);
  const sx = W / BLAZE_IN, sy = H / BLAZE_IN;
  let i = 0;
  for (let y = 0; y < BLAZE_IN; y++) for (let x = 0; x < BLAZE_IN; x++) {
    const si = (Math.floor(y * sy) * W + Math.floor(x * sx)) * RGB;
    out[i++] = (src[si]     / 127.5) - 1;
    out[i++] = (src[si + 1] / 127.5) - 1;
    out[i++] = (src[si + 2] / 127.5) - 1;
  }
  return out;
}

function decodeBox(
  scores: Float32Array, regs: Float32Array, anchors: Float32Array,
): { x1: number; y1: number; x2: number; y2: number } | null {
  'worklet';
  let best = -1, bestS = THRESHOLD;
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

function cropAndMeshInput(
  src: Uint8Array, W: number, H: number,
  x1: number, y1: number, x2: number, y2: number,
): { meshIn: Float32Array; rgba: Uint8Array; cW: number; cH: number } {
  'worklet';
  const cx1 = Math.max(0,     Math.floor((x1 - PAD) * W));
  const cy1 = Math.max(0,     Math.floor((y1 - PAD) * H));
  const cx2 = Math.min(W - 1, Math.ceil ((x2 + PAD) * W));
  const cy2 = Math.min(H - 1, Math.ceil ((y2 + PAD) * H));
  const cW = cx2 - cx1, cH = cy2 - cy1;

  const rgba = new Uint8Array(cW * cH * RGBA);
  for (let row = 0; row < cH; row++) for (let col = 0; col < cW; col++) {
    const si = ((cy1 + row) * W + (cx1 + col)) * RGB;
    const di = (row * cW + col) * RGBA;
    rgba[di] = src[si]; rgba[di+1] = src[si+1]; rgba[di+2] = src[si+2]; rgba[di+3] = 255;
  }

  const sx = cW / MESH_IN, sy = cH / MESH_IN;
  const meshIn = new Float32Array(MESH_IN * MESH_IN * 3);
  let i = 0;
  for (let y = 0; y < MESH_IN; y++) for (let x = 0; x < MESH_IN; x++) {
    const si = (Math.floor(y * sy) * cW + Math.floor(x * sx)) * RGBA;
    meshIn[i++] = rgba[si]     / 255;
    meshIn[i++] = rgba[si + 1] / 255;
    meshIn[i++] = rgba[si + 2] / 255;
  }
  return { meshIn, rgba, cW, cH };
}

function parseLandmarks(raw: Float32Array): Landmark[] {
  'worklet';
  const lms: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    lms.push([raw[i*3]/MESH_IN, raw[i*3+1]/MESH_IN, raw[i*3+2]/MESH_IN]);
  }
  return lms;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDetectAndMesh(onResult: (r: DetectResult | null) => void) {
  const blaze = useTensorflowModel(require('../../models/blazeface.tflite'));
  const mesh  = useTensorflowModel(require('../../models/facemesh.tflite'));
  const cb    = useRunOnJS(onResult, [onResult]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (blaze.state !== 'loaded' || !blaze.model) return;
    if (mesh.state  !== 'loaded' || !mesh.model)  return;

    const W   = frame.width;
    const H   = frame.height;
    const src = new Uint8Array(frame.toArrayBuffer());

    const bOut    = blaze.model.runSync([blazeInput(src, W, H)]) as Float32Array[];
    const box     = decodeBox(bOut[0], bOut[1], ANCHOR_DATA);
    if (!box) { cb(null); return; }

    const { meshIn, rgba, cW, cH } = cropAndMeshInput(src, W, H, box.x1, box.y1, box.x2, box.y2);
    const mOut      = mesh.model.runSync([meshIn]) as Float32Array[];
    const landmarks = parseLandmarks(mOut[0]);

    cb({ landmarks, faceRGBA: rgba, faceWidth: cW, faceHeight: cH });
  }, [blaze, mesh, cb]);

  const isLoading = blaze.state !== 'loaded' || mesh.state !== 'loaded';
  return { frameProcessor, isLoading };
}
