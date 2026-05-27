# Model Files — Download Required

These binary `.tflite` files are NOT included in the repository (git-ignored).

## Download commands

Run these from the project root:

```bash
# 1. BlazeFace (face detection, ~1 MB)
wget "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite" \
     -O models/blazeface.tflite

# 2. MediaPipe FaceLandmarker (liveness, ~3 MB)
wget "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
     -O models/facemesh.tflite

# 3. MobileFaceNet INT8 (face recognition, ~4 MB)
# Convert yourself using docs/model_conversion.md
# OR download a community INT8 build from:
# https://github.com/shubham0204/FaceRecognition_With_FaceNet_Android/tree/master/app/src/main/assets
# Rename facenet_int8.tflite → mobilefacenet_int8.tflite
```

After download, verify:
```
models/
├── blazeface.tflite              (~1.0 MB)
├── facemesh.tflite               (~3.2 MB)
└── mobilefacenet_int8.tflite     (~3.8 MB)
                            Total: ~8.0 MB
```

See `docs/model_conversion.md` for the full INT8 quantization pipeline.
