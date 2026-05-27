"""
gen_placeholder_model.py

Generates a minimal TFLite model with the correct tensor shapes for
MobileFaceNet INT8.

  Input:  [1, 112, 112, 3]  float32  (normalized to [-1, 1])
  Output: [1, 128]          float32  (L2-normalized face embedding)

This is a PLACEHOLDER only — weights are random.
Replace models/mobilefacenet_int8.tflite with a real pre-trained model
before running production inference (see docs/model_conversion.md).
"""

import os, sys

os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"]  = "3"

import tensorflow as tf

inp = tf.keras.Input(shape=(112, 112, 3), name="input_1")
x   = tf.keras.layers.DepthwiseConv2D(3, padding="same", activation="relu")(inp)
x   = tf.keras.layers.GlobalAveragePooling2D()(x)
x   = tf.keras.layers.Dense(128, use_bias=False)(x)
out = tf.keras.layers.Lambda(
    lambda v: tf.math.l2_normalize(v, axis=1), name="embeddings"
)(x)
model = tf.keras.Model(inp, out)

converter              = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model           = converter.convert()

out_path = os.path.join(os.path.dirname(__file__), "models", "mobilefacenet_int8.tflite")
with open(out_path, "wb") as f:
    f.write(tflite_model)

print(f"[OK] placeholder model written: {out_path}  ({len(tflite_model)//1024} KB)")
print(f"     Input : {model.input_shape}")
print(f"     Output: {model.output_shape}")
