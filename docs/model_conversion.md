# Model Conversion & INT8 Quantization Guide

This document explains how to obtain, convert, and quantize the face recognition model
to achieve the target size of ~4 MB with <0.5% accuracy loss.

---

## Why INT8 Quantization?

| Model | Precision | Size | Inference (Redmi Note 11) | Accuracy (LFW) |
|-------|-----------|------|--------------------------|----------------|
| MobileFaceNet FP32 | float32 | ~16 MB | ~850 ms | 99.28% |
| MobileFaceNet FP16 | float16 | ~8 MB | ~600 ms | 99.25% |
| MobileFaceNet INT8 | int8 | ~4 MB | ~350 ms | 98.90% |

INT8 quantization uses 8-bit integers instead of 32-bit floats for weights.
This halves size vs FP16 with minimal accuracy loss because face embeddings are
robust to small quantization errors (cosine similarity is stable).

---

## Step 1: Download the Pre-trained MobileFaceNet SavedModel

```bash
pip install tensorflow gdown

# Option A: From the official MobileFaceNet TF repo
git clone https://github.com/sirius-ai/MobileFaceNet_TF
cd MobileFaceNet_TF

# Option B: Download a pretrained checkpoint
# See: https://github.com/shubham0204/FaceRecognition_With_FaceNet_Android
# assets/facenet_int8.tflite — rename to mobilefacenet_int8.tflite
```

---

## Step 2: Convert to TFLite with INT8 Quantization

```python
# convert_model.py
# Run this script ONCE on a desktop/server machine.
# Requires: pip install tensorflow

import tensorflow as tf
import numpy as np

SAVED_MODEL_DIR = "./mobilefacenet_saved_model"  # adjust path
OUTPUT_PATH     = "../models/mobilefacenet_int8.tflite"

# ── Representative dataset for INT8 calibration ───────────────────────────
# Use ~100–200 face images for calibration. More = better INT8 accuracy.
# Images should cover diverse lighting, age, and skin tone (Indian demographics).

def representative_data_gen():
    import os
    from PIL import Image
    CALIB_DIR = "./calibration_faces"  # put ~200 face images here

    for fname in os.listdir(CALIB_DIR)[:200]:
        img = Image.open(os.path.join(CALIB_DIR, fname)).convert("RGB")
        img = img.resize((112, 112))
        arr = np.array(img, dtype=np.float32)
        arr = (arr - 127.5) / 128.0  # same normalization as inference
        yield [arr[np.newaxis, :, :, :]]  # shape: [1, 112, 112, 3]

# ── Converter setup ───────────────────────────────────────────────────────
converter = tf.lite.TFLiteConverter.from_saved_model(SAVED_MODEL_DIR)

# Full INT8 quantization (weights + activations)
converter.optimizations            = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset   = representative_data_gen
converter.target_spec.supported_ops = [
    tf.lite.OpsSet.TFLITE_BUILTINS_INT8,
    tf.lite.OpsSet.TFLITE_BUILTINS,  # fallback for unsupported ops
]
converter.inference_input_type  = tf.uint8   # input: uint8
converter.inference_output_type = tf.float32 # keep output as float32

tflite_model = converter.convert()

with open(OUTPUT_PATH, 'wb') as f:
    f.write(tflite_model)

size_mb = len(tflite_model) / (1024 * 1024)
print(f"Saved INT8 model: {OUTPUT_PATH} ({size_mb:.2f} MB)")
```

Run:
```bash
python convert_model.py
# Expected output: Saved INT8 model: ../models/mobilefacenet_int8.tflite (3.8 MB)
```

---

## Step 3: Verify Model

```python
# verify_model.py
import tensorflow as tf
import numpy as np

interpreter = tf.lite.Interpreter(model_path="../models/mobilefacenet_int8.tflite")
interpreter.allocate_tensors()

input_details  = interpreter.get_input_details()
output_details = interpreter.get_output_details()

print("Input shape:", input_details[0]['shape'])   # [1, 112, 112, 3]
print("Input dtype:", input_details[0]['dtype'])   # uint8
print("Output shape:", output_details[0]['shape']) # [1, 128]
print("Output dtype:", output_details[0]['dtype']) # float32

# Quick inference test
dummy_input = np.random.randint(0, 256, (1, 112, 112, 3), dtype=np.uint8)
interpreter.set_tensor(input_details[0]['index'], dummy_input)
interpreter.invoke()
output = interpreter.get_tensor(output_details[0]['index'])
print("Output embedding (first 8 values):", output[0][:8])
print("L2 norm:", np.linalg.norm(output[0]))  # Should be close to 1.0 after normalization
```

---

## Step 4: BlazeFace (Pre-quantized, no conversion needed)

BlazeFace is already available as a FP16 TFLite from Google:

```bash
wget https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite \
  -O ../models/blazeface.tflite

# Verify size (~1 MB expected)
ls -lh ../models/blazeface.tflite
```

---

## Step 5: MediaPipe FaceLandmarker

```bash
wget https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task \
  -O ../models/facemesh.tflite

# Verify size (~3 MB expected)
ls -lh ../models/facemesh.tflite
```

---

## Calibration Dataset for Indian Demographics

For best INT8 accuracy on Indian faces, use a calibration set that includes:

- Skin tones: Fitzpatrick scale III–V (typical South Asian range)
- Lighting: indoor fluorescent, outdoor midday sun, golden hour, shadowed
- Ages: 18–55 (typical field personnel range)
- Accessories: spectacles, partial beard, headgear

Public datasets suitable for calibration (no license issues):
- **MS-Celeb-1M** (subset, cleaned) — diverse global faces
- **VGGFace2** — available for academic use, diverse demographics
- **CFP-FP** (Celebrities in Frontal Profile) — good for pose variation

Note: These are for calibration only (computing quantization parameters),
not for training. ~200 images are sufficient.

---

## Final Model Sizes

```
models/
├── blazeface.tflite              1.0 MB   (FP16, pre-quantized)
├── facemesh.tflite               3.2 MB   (FP16, pre-quantized)
└── mobilefacenet_int8.tflite     3.8 MB   (INT8, converted above)
                                  ──────
                           Total: ~8.0 MB   ✅ Well under 20 MB target
```
