/**
 * useDetectAndMesh.ts
 *
 * VisionCamera frame processor plugin that runs:
 *   1. BlazeFace TFLite   → face bounding box
 *   2. face_landmark TFLite → 468 × [x, y, z] landmarks
 *
 * Both models run synchronously inside the frame processor worklet via
 * react-native-fast-tflite's `runSync()`, so no bridge hop occurs per frame.
 *
 * Pixel format: Camera must be configured with pixelFormat="rgb"
 *   → VisionCamera v4 gives 3 bytes/pixel (R, G, B) from frame.toArrayBuffer()
 *   → The face crop is expanded to RGBA (stride 4) for compatibility with
 *     FaceRecognizer.ts / BiometricAuth which expect RGBA buffers.
 *
 * Model specs
 * ───────────────────────────────────────────────────────────────
 * BlazeFace short-range (float16 TFLite)
 *   Input:   [1, 128, 128, 3]  float32, values ∈ [−1, 1]
 *   Output0: [1, 896, 1]       float32  per-anchor sigmoid scores
 *   Output1: [1, 896, 16]      float32  [dCx,dCy,dW,dH, kp0x…kp5y]
 *
 * face_landmark.tflite (MediaPipe 468-pt)
 *   Input:   [1, 192, 192, 3]  float32, values ∈ [0, 1]
 *   Output0: [1404]            float32  468 × [x,y,z] in px of 192×192 (÷192 → [0,1])
 *   Output1: [1]               float32  face-presence score
 *
 * BlazeFace SSD anchor layout (896 total):
 *   Layer 0 (stride 8):  16×16 grid × 2/cell = 512
 *   Layers 1-3 (stride 16): 8×8 grid × 6/cell = 384
 */

import { useMemo }             from 'react';
import { useTensorflowModel }  from 'react-native-fast-tflite';
import { useFrameProcessor }   from 'react-native-vision-camera';
import { useRunOnJS }           from 'react-native-worklets-core';

import type { Landmark } from '../modules/LivenessChecker';

// ── Public types ─────────────────────────────────────────────────────────────

export interface FaceBox {
  x1: number; x2: number;
  y1: number; y2: number;
  score: number;
}

export interface DetectAndMeshResult {
  /** 468 × [x, y, z] landmarks, all coordinates ∈ [0, 1] */
  landmarks:  Landmark[];
  /** Raw RGBA bytes (stride 4) of the cropped face region */
  faceRGBA:   Uint8Array;
  faceWidth:  number;
  faceHeight: number;
  box:        FaceBox;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BLAZE_SIZE   = 128;
const MESH_SIZE    = 192;
const NUM_ANCHORS  = 896;
const SCORE_THRESH = 0.75;
const BOX_PAD      = 0.10;
const RGB_STRIDE   = 3; // VisionCamera 'rgb' format: 3 bytes per pixel
const RGBA_STRIDE  = 4; // downstream code expects RGBA

// ── Pre-computed BlazeFace SSD anchor CX/CY ──────────────────────────────────
// flat [cx0,cy0, cx1,cy1, …] for all 896 anchors

function buildAnchors(): Float32Array {
  const a   = new Float32Array(NUM_ANCHORS * 2);
  let   idx = 0;

  // Layer 0: stride=8 → 16×16 grid, 2 anchors/cell
  for (let r = 0; r < 16; r++)
    for (let c = 0; c < 16; c++)
      for (let k = 0; k < 2; k++) {
        a[idx++] = (c + 0.5) / 16;
        a[idx++] = (r + 0.5) / 16;
      }

  // Layers 1-3: stride=16 → 8×8 grid, 6 anchors/cell (3 grouped layers × 2)
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      for (let k = 0; k < 6; k++) {
        a[idx++] = (c + 0.5) / 8;
        a[idx++] = (r + 0.5) / 8;
      }

  return a;
}

const ANCHORS = buildAnchors();

// ── Worklet helpers (called directly from the frame processor) ────────────────

/**
 * Resize RGB frame (stride 3) to BLAZE_SIZE×BLAZE_SIZE and normalise to [-1, 1].
 */
function makeBlazeInput(src: Uint8Array, srcW: number, srcH: number): Float32Array {
  'worklet';
  const out = new Float32Array(BLAZE_SIZE * BLAZE_SIZE * 3);
  const sx  = srcW / BLAZE_SIZE;
  const sy  = srcH / BLAZE_SIZE;
  let   idx = 0;
  for (let py = 0; py < BLAZE_SIZE; py++) {
    for (let px = 0; px < BLAZE_SIZE; px++) {
      const si = (Math.floor(py * sy) * srcW + Math.floor(px * sx)) * RGB_STRIDE;
      out[idx++] = (src[si]     / 127.5) - 1.0;
      out[idx++] = (src[si + 1] / 127.5) - 1.0;
      out[idx++] = (src[si + 2] / 127.5) - 1.0;
    }
  }
  return out;
}

/**
 * Decode the highest-scoring BlazeFace SSD anchor.
 * Returns null when no anchor exceeds SCORE_THRESH.
 *
 * scores:  Float32Array of length NUM_ANCHORS  (flattened [1,896,1])
 * regs:    Float32Array of length 896×16       (flattened [1,896,16])
 */
function decodeBlazeBox(
  scores: Float32Array,
  regs:   Float32Array,
): FaceBox | null {
  'worklet';
  let best  = -1;
  let bestS = SCORE_THRESH;
  for (let i = 0; i < NUM_ANCHORS; i++) {
    if (scores[i] > bestS) { bestS = scores[i]; best = i; }
  }
  if (best < 0) return null;

  const aCx = ANCHORS[best * 2];
  const aCy = ANCHORS[best * 2 + 1];
  const dCx = regs[best * 16]     / BLAZE_SIZE + aCx;
  const dCy = regs[best * 16 + 1] / BLAZE_SIZE + aCy;
  const dW  = regs[best * 16 + 2] / BLAZE_SIZE;
  const dH  = regs[best * 16 + 3] / BLAZE_SIZE;
  return {
    x1: dCx - dW / 2, x2: dCx + dW / 2,
    y1: dCy - dH / 2, y2: dCy + dH / 2,
    score: bestS,
  };
}

/**
 * Crop face from RGB frame (stride 3), output:
 *   - cropRGBA: Uint8Array stride 4 (RGBA with A=255) for downstream code
 *   - meshInput: Float32Array [MESH_SIZE×MESH_SIZE×3] normalised to [0,1]
 */
function cropAndMakeMeshInput(
  src:  Uint8Array,
  srcW: number,
  srcH: number,
  box:  FaceBox,
): { meshInput: Float32Array; cropRGBA: Uint8Array; cW: number; cH: number } {
  'worklet';

  const cx1 = Math.max(0,        Math.floor((box.x1 - BOX_PAD) * srcW));
  const cy1 = Math.max(0,        Math.floor((box.y1 - BOX_PAD) * srcH));
  const cx2 = Math.min(srcW - 1, Math.ceil ((box.x2 + BOX_PAD) * srcW));
  const cy2 = Math.min(srcH - 1, Math.ceil ((box.y2 + BOX_PAD) * srcH));
  const cW  = cx2 - cx1;
  const cH  = cy2 - cy1;

  // Copy crop: expand RGB(stride 3) → RGBA(stride 4, A=255)
  const cropRGBA = new Uint8Array(cW * cH * RGBA_STRIDE);
  for (let row = 0; row < cH; row++) {
    for (let col = 0; col < cW; col++) {
      const si = ((cy1 + row) * srcW + (cx1 + col)) * RGB_STRIDE;
      const di = (row * cW + col) * RGBA_STRIDE;
      cropRGBA[di]     = src[si];
      cropRGBA[di + 1] = src[si + 1];
      cropRGBA[di + 2] = src[si + 2];
      cropRGBA[di + 3] = 255;
    }
  }

  // Resize crop (RGBA stride 4) to MESH_SIZE×MESH_SIZE, normalise to [0,1]
  const sx  = cW / MESH_SIZE;
  const sy  = cH / MESH_SIZE;
  const meshInput = new Float32Array(MESH_SIZE * MESH_SIZE * 3);
  let   idx = 0;
  for (let py = 0; py < MESH_SIZE; py++) {
    for (let px = 0; px < MESH_SIZE; px++) {
      const si = (Math.floor(py * sy) * cW + Math.floor(px * sx)) * RGBA_STRIDE;
      meshInput[idx++] = cropRGBA[si]     / 255.0;
      meshInput[idx++] = cropRGBA[si + 1] / 255.0;
      meshInput[idx++] = cropRGBA[si + 2] / 255.0;
    }
  }

  return { meshInput, cropRGBA, cW, cH };
}

/**
 * Parse the flat [1404] face_landmark output into 468 × Landmark.
 * Coordinates are in pixel space of the 192×192 input → divide by MESH_SIZE.
 */
function parseLandmarks(raw: Float32Array): Landmark[] {
  'worklet';
  const lms: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    lms.push([
      raw[i * 3]     / MESH_SIZE,
      raw[i * 3 + 1] / MESH_SIZE,
      raw[i * 3 + 2] / MESH_SIZE,
    ]);
  }
  return lms;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useDetectAndMesh
 *
 * Loads BlazeFace and face_landmark TFLite models and returns a VisionCamera
 * frameProcessor for passing directly to `<Camera frameProcessor={…} />`.
 *
 * Per-frame pipeline (runs in the worklet thread):
 *   1. frame.toArrayBuffer() → RGB bytes (stride 3)
 *   2. BlazeFace detection → FaceBox
 *   3. Crop face, expand to RGBA → FaceMesh input
 *   4. FaceMesh → 468 × [x, y, z] landmarks
 *   5. useRunOnJS callback → {landmarks, faceRGBA, faceWidth, faceHeight, box}
 *      or null when no face is found
 *
 * @param onResult  JS-thread callback. Memoize with useCallback to avoid
 *                  unnecessary frame-processor rebuilds.
 */
export function useDetectAndMesh(
  onResult: (result: DetectAndMeshResult | null) => void,
) {
  const blazeModel = useTensorflowModel(
    require('../../models/blazeface.tflite')
  );
  const meshModel = useTensorflowModel(
    require('../../models/facemesh.tflite')
  );

  // Worklet-compatible JS-thread callback
  const jsCallback = useRunOnJS(onResult, [onResult]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      if (
        blazeModel.state !== 'loaded' || blazeModel.model == null ||
        meshModel.state  !== 'loaded' || meshModel.model  == null
      ) {
        return;
      }

      const W   = frame.width;
      const H   = frame.height;
      const src = new Uint8Array(frame.toArrayBuffer());

      // ── 1. BlazeFace ─────────────────────────────────────────────────────
      const bfInput                     = makeBlazeInput(src, W, H);
      const bfOutputs                   = blazeModel.model.runSync([bfInput]) as Float32Array[];
      const [bfScores, bfRegs]          = bfOutputs;

      const box = decodeBlazeBox(bfScores, bfRegs);
      if (box == null) {
        jsCallback(null);
        return;
      }

      // ── 2. Crop face + FaceMesh ──────────────────────────────────────────
      const { meshInput, cropRGBA, cW, cH } =
        cropAndMakeMeshInput(src, W, H, box);

      const meshOutputs         = meshModel.model.runSync([meshInput]) as Float32Array[];
      const [rawLandmarks]      = meshOutputs;

      const landmarks = parseLandmarks(rawLandmarks);

      // ── 3. Return to JS thread ────────────────────────────────────────────
      jsCallback({ landmarks, faceRGBA: cropRGBA, faceWidth: cW, faceHeight: cH, box });
    },
    [blazeModel, meshModel, jsCallback],
  );

  const isLoading =
    blazeModel.state !== 'loaded' || meshModel.state !== 'loaded';

  return { frameProcessor, isLoading };
}
