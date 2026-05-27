# Performance Benchmarks

Fill in this table after running on real devices. Target devices: Redmi Note 11,
Samsung Galaxy A32, Realme 8 (all common Indian mid-range, 3–4 GB RAM).

---

## Model Size (Target: < 20 MB total)

| Model | Size |
|-------|------|
| blazeface.tflite | ~1.0 MB |
| facemesh.tflite | ~3.2 MB |
| mobilefacenet_int8.tflite | ~3.8 MB |
| **Total** | **~8.0 MB** ✅ |

---

## Inference Latency (Target: < 1000 ms end-to-end)

Benchmark methodology: average of 50 runs on a physical device with room temperature,
fully charged battery, no other apps in foreground.

| Stage | Redmi Note 11 | Samsung A32 | Realme 8 |
|-------|--------------|-------------|----------|
| CLAHE preprocessing | ___ ms | ___ ms | ___ ms |
| BlazeFace detection | ___ ms | ___ ms | ___ ms |
| MediaPipe FaceMesh (478 pts) | ___ ms | ___ ms | ___ ms |
| MobileFaceNet INT8 embedding | ___ ms | ___ ms | ___ ms |
| Cosine similarity + decision | < 1 ms | < 1 ms | < 1 ms |
| **Total pipeline** | **___ ms** | **___ ms** | **___ ms** |

Expected totals (based on published benchmarks):
- Redmi Note 11 (Snapdragon 680): ~650–750 ms
- Samsung Galaxy A32 (Helio G80): ~700–800 ms

---

## Recognition Accuracy

| Metric | Value | Notes |
|--------|-------|-------|
| True Accept Rate (TAR) | ___ % | @ 0.1% FAR |
| False Accept Rate (FAR) | ___ % | Random impostor pairs |
| False Reject Rate (FRR) | ___ % | Same-person pairs |
| Threshold used | 0.72 | Cosine similarity |
| Test set size | ___ persons | Captured on device |

---

## Lighting Conditions (Target: > 95% accuracy in all)

| Condition | TAR |
|-----------|-----|
| Indoor fluorescent | ___ % |
| Outdoor midday direct sun | ___ % |
| Outdoor shade | ___ % |
| Low light (evening) | ___ % |
| Backlit (window behind subject) | ___ % |

---

## Liveness Detection

| Challenge | Detection Rate | False Positive Rate |
|-----------|---------------|-------------------|
| Blink (EAR threshold 0.21) | ___ % | ___ % |
| Smile (MAR threshold 0.15) | ___ % | ___ % |
| Turn left (yaw threshold 0.12) | ___ % | ___ % |
| Turn right (yaw threshold 0.12) | ___ % | ___ % |

Photo spoofing resistance: tested with printed A4 photos and screen replay —
randomized challenge sequence makes replay attacks impractical.

---

## Memory Usage

| Metric | Value |
|--------|-------|
| App memory at idle | ___ MB |
| Peak during inference | ___ MB |
| SQLite file size (100 records) | ___ KB |
| Embedding size per user | 512 bytes (128 × float32) |

---

## Sync Performance

| Metric | Value |
|--------|-------|
| Time to sync 100 records | ___ ms |
| Time to sync 1000 records | ___ ms |
| DynamoDB batch write latency | ___ ms |
| Local purge time | ___ ms |
