/**
 * BiometricModule.java
 *
 * Android native module: TFLite inference for BlazeFace, face_landmark, and
 * MobileFaceNet, bridged to React Native JS.
 *
 * Build.gradle additions required (android/app/build.gradle):
 *   implementation 'org.tensorflow:tensorflow-lite:2.14.0'
 *   implementation 'org.tensorflow:tensorflow-lite-support:0.4.4'
 *
 * Model assets – copy to android/app/src/main/assets/:
 *   blazeface.tflite          (~230 KB, float16)
 *   facemesh.tflite           (~1.2 MB, raw TFLite face_landmark 468-pt)
 *   mobilefacenet_int8.tflite (~4 MB, INT8 quantized)
 *
 * Registration – MainApplication.java:
 *   packages.add(new BiometricPackage());
 *
 * Note: for true hardware-accelerated CLAHE add:
 *   implementation 'org.opencv:opencv:4.8.0'
 * and replace applyHistogramEqualization() with the OpenCV CLAHE call.
 */

package com.datalakebiometric;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.util.Base64;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import org.tensorflow.lite.Interpreter;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;

public class BiometricModule extends ReactContextBaseJavaModule {
    private static final String TAG         = "BiometricModule";
    private static final String MODULE_NAME = "BiometricModule";

    private static final String BLAZEFACE_MODEL = "blazeface.tflite";
    private static final String FACEMESH_MODEL  = "facemesh.tflite";
    private static final String FACERECOG_MODEL = "mobilefacenet_int8.tflite";

    private static final int BLAZE_INPUT_SIZE = 128;
    private static final int MESH_INPUT_SIZE  = 192;
    private static final int RECOG_INPUT_SIZE = 112;
    private static final int EMBED_DIM        = 128;
    private static final int NUM_LM           = 468;     // face_landmark.tflite landmarks
    private static final int NUM_ANCHORS      = 896;
    private static final float SCORE_THRESH   = 0.75f;

    // ── Pre-computed BlazeFace short-range SSD anchor CX/CY ─────────────────
    // flat [cx0,cy0, cx1,cy1, …], length = NUM_ANCHORS × 2
    // Layer 0 (stride 8):  16×16 grid, 2/cell → 512 anchors
    // Layers 1-3 (stride 16): 8×8 grid, 6/cell → 384 anchors
    private static final float[] ANCHORS = buildAnchors();

    private Interpreter blazeFaceInterpreter;
    private Interpreter faceMeshInterpreter;
    private Interpreter faceRecogInterpreter;

    private boolean isInitialized = false;

    public BiometricModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() { return MODULE_NAME; }

    // ─── Anchor generation ──────────────────────────────────────────────────
    private static float[] buildAnchors() {
        float[] a = new float[NUM_ANCHORS * 2];
        int idx = 0;
        // Layer 0: stride=8, 16×16 grid, 2 anchors/cell
        for (int y = 0; y < 16; y++)
            for (int x = 0; x < 16; x++)
                for (int k = 0; k < 2; k++) {
                    a[idx++] = (x + 0.5f) / 16f;
                    a[idx++] = (y + 0.5f) / 16f;
                }
        // Layers 1-3: stride=16, 8×8 grid, 6 anchors/cell
        for (int y = 0; y < 8; y++)
            for (int x = 0; x < 8; x++)
                for (int k = 0; k < 6; k++) {
                    a[idx++] = (x + 0.5f) / 8f;
                    a[idx++] = (y + 0.5f) / 8f;
                }
        return a;
    }

    // ─── Initialize all three TFLite models ──────────────────────────────────
    @ReactMethod
    public void initialize(Promise promise) {
        try {
            Context ctx  = getReactApplicationContext();
            Interpreter.Options opts = new Interpreter.Options().setNumThreads(2);

            blazeFaceInterpreter = new Interpreter(loadModelFile(ctx, BLAZEFACE_MODEL), opts);
            faceMeshInterpreter  = new Interpreter(loadModelFile(ctx, FACEMESH_MODEL),  opts);
            faceRecogInterpreter = new Interpreter(loadModelFile(ctx, FACERECOG_MODEL), opts);

            isInitialized = true;
            Log.d(TAG, "BiometricModule initialized (BlazeFace + FaceMesh + MobileFaceNet)");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Initialization failed", e);
            promise.reject("INIT_FAILED", e.getMessage());
        }
    }

    // ─── Face detection (BlazeFace) ──────────────────────────────────────────
    @ReactMethod
    public void detectFace(String frameBase64, int width, int height, Promise promise) {
        if (!isInitialized) { promise.reject("NOT_INIT", "Call initialize() first"); return; }
        try {
            byte[]  rgba   = Base64.decode(frameBase64, Base64.DEFAULT);
            Bitmap  bmp    = rgbaToBitmap(rgba, width, height);
            bmp = applyHistogramEqualization(bmp);
            Bitmap  scaled = Bitmap.createScaledBitmap(bmp, BLAZE_INPUT_SIZE, BLAZE_INPUT_SIZE, true);

            // Build float input [1][128][128][3], normalized to [-1, 1]
            float[][][][] input = new float[1][BLAZE_INPUT_SIZE][BLAZE_INPUT_SIZE][3];
            int[] pixels = new int[BLAZE_INPUT_SIZE * BLAZE_INPUT_SIZE];
            scaled.getPixels(pixels, 0, BLAZE_INPUT_SIZE, 0, 0, BLAZE_INPUT_SIZE, BLAZE_INPUT_SIZE);
            for (int y = 0; y < BLAZE_INPUT_SIZE; y++)
                for (int x = 0; x < BLAZE_INPUT_SIZE; x++) {
                    int px = pixels[y * BLAZE_INPUT_SIZE + x];
                    input[0][y][x][0] = (((px >> 16) & 0xFF) / 127.5f) - 1.0f;
                    input[0][y][x][1] = (((px >>  8) & 0xFF) / 127.5f) - 1.0f;
                    input[0][y][x][2] = (( px        & 0xFF) / 127.5f) - 1.0f;
                }

            // Output0: scores [1,896,1], Output1: regressors [1,896,16]
            float[][][] scores = new float[1][NUM_ANCHORS][1];
            float[][][] regs   = new float[1][NUM_ANCHORS][16];
            Map<Integer, Object> outputs = new HashMap<>();
            outputs.put(0, scores);
            outputs.put(1, regs);
            blazeFaceInterpreter.runForMultipleInputsOutputs(new Object[]{input}, outputs);

            // Find highest-confidence detection
            int   bestIdx  = -1;
            float bestScore = SCORE_THRESH;
            for (int i = 0; i < NUM_ANCHORS; i++) {
                if (scores[0][i][0] > bestScore) {
                    bestScore = scores[0][i][0];
                    bestIdx   = i;
                }
            }

            if (bestIdx < 0) { promise.resolve(null); return; }

            float aCx = ANCHORS[bestIdx * 2];
            float aCy = ANCHORS[bestIdx * 2 + 1];
            float dCx = regs[0][bestIdx][0] / BLAZE_INPUT_SIZE + aCx;
            float dCy = regs[0][bestIdx][1] / BLAZE_INPUT_SIZE + aCy;
            float dW  = regs[0][bestIdx][2] / BLAZE_INPUT_SIZE;
            float dH  = regs[0][bestIdx][3] / BLAZE_INPUT_SIZE;

            WritableMap result = Arguments.createMap();
            result.putDouble("x1",    dCx - dW / 2f);
            result.putDouble("y1",    dCy - dH / 2f);
            result.putDouble("x2",    dCx + dW / 2f);
            result.putDouble("y2",    dCy + dH / 2f);
            result.putDouble("score", bestScore);
            promise.resolve(result);

        } catch (Exception e) {
            promise.reject("DETECT_FAILED", e.getMessage());
        }
    }

    // ─── Face landmarks (face_landmark.tflite, 468 pts) ──────────────────────
    @ReactMethod
    public void getFaceLandmarks(String faceBase64, int width, int height, Promise promise) {
        if (!isInitialized) { promise.reject("NOT_INIT", "Call initialize() first"); return; }
        try {
            byte[]  rgba  = Base64.decode(faceBase64, Base64.DEFAULT);
            float[][][][] input = preprocessForMesh(rgba, width, height);

            // face_landmark outputs:
            //   0: landmarks [*] – 468 × 3 values, pixel coords of 192×192 input
            //   1: face flag [*] – single float presence score
            float[] landmarks = new float[NUM_LM * 3];
            float[] faceFlag  = new float[1];
            Map<Integer, Object> outputs = new HashMap<>();
            outputs.put(0, landmarks);
            outputs.put(1, faceFlag);
            faceMeshInterpreter.runForMultipleInputsOutputs(new Object[]{input}, outputs);

            if (faceFlag[0] < 0.5f) { promise.resolve(null); return; }

            WritableArray arr = Arguments.createArray();
            for (int i = 0; i < NUM_LM; i++) {
                WritableArray pt = Arguments.createArray();
                pt.pushDouble(landmarks[i * 3]     / MESH_INPUT_SIZE); // normalize x
                pt.pushDouble(landmarks[i * 3 + 1] / MESH_INPUT_SIZE); // normalize y
                pt.pushDouble(landmarks[i * 3 + 2] / MESH_INPUT_SIZE); // z
                arr.pushArray(pt);
            }
            promise.resolve(arr);

        } catch (Exception e) {
            promise.reject("LANDMARK_FAILED", e.getMessage());
        }
    }

    // ─── Face recognition (MobileFaceNet) ────────────────────────────────────
    @ReactMethod
    public void getEmbedding(String faceBase64, int width, int height, Promise promise) {
        if (!isInitialized) { promise.reject("NOT_INIT", "Call initialize() first"); return; }
        try {
            byte[]  rgba  = Base64.decode(faceBase64, Base64.DEFAULT);
            float[][][][] input = preprocessForFaceRecog(rgba, width, height);

            float[][] output = new float[1][EMBED_DIM];
            faceRecogInterpreter.run(input, output);

            float[] normalized = l2Normalize(output[0]);
            WritableArray arr  = Arguments.createArray();
            for (float v : normalized) arr.pushDouble(v);
            promise.resolve(arr);

        } catch (Exception e) {
            promise.reject("EMBED_FAILED", e.getMessage());
        }
    }

    // ─── Preprocessing helpers ───────────────────────────────────────────────

    private Bitmap rgbaToBitmap(byte[] rgba, int width, int height) {
        Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bmp.copyPixelsFromBuffer(ByteBuffer.wrap(rgba));
        return bmp;
    }

    /** Resize face crop to MESH_INPUT_SIZE, normalise to [0, 1] for face_landmark. */
    private float[][][][] preprocessForMesh(byte[] rgba, int srcW, int srcH) {
        Bitmap bmp    = rgbaToBitmap(rgba, srcW, srcH);
        Bitmap scaled = Bitmap.createScaledBitmap(bmp, MESH_INPUT_SIZE, MESH_INPUT_SIZE, true);
        int[]  pixels = new int[MESH_INPUT_SIZE * MESH_INPUT_SIZE];
        scaled.getPixels(pixels, 0, MESH_INPUT_SIZE, 0, 0, MESH_INPUT_SIZE, MESH_INPUT_SIZE);

        float[][][][] input = new float[1][MESH_INPUT_SIZE][MESH_INPUT_SIZE][3];
        for (int y = 0; y < MESH_INPUT_SIZE; y++)
            for (int x = 0; x < MESH_INPUT_SIZE; x++) {
                int px = pixels[y * MESH_INPUT_SIZE + x];
                input[0][y][x][0] = ((px >> 16) & 0xFF) / 255.0f;
                input[0][y][x][1] = ((px >>  8) & 0xFF) / 255.0f;
                input[0][y][x][2] = ( px        & 0xFF) / 255.0f;
            }
        return input;
    }

    /** Resize face crop to RECOG_INPUT_SIZE, normalise to [-1, 1] for MobileFaceNet. */
    private float[][][][] preprocessForFaceRecog(byte[] rgba, int srcW, int srcH) {
        Bitmap bmp    = rgbaToBitmap(rgba, srcW, srcH);
        Bitmap scaled = Bitmap.createScaledBitmap(bmp, RECOG_INPUT_SIZE, RECOG_INPUT_SIZE, true);
        int[]  pixels = new int[RECOG_INPUT_SIZE * RECOG_INPUT_SIZE];
        scaled.getPixels(pixels, 0, RECOG_INPUT_SIZE, 0, 0, RECOG_INPUT_SIZE, RECOG_INPUT_SIZE);

        float[][][][] input = new float[1][RECOG_INPUT_SIZE][RECOG_INPUT_SIZE][3];
        for (int y = 0; y < RECOG_INPUT_SIZE; y++)
            for (int x = 0; x < RECOG_INPUT_SIZE; x++) {
                int px = pixels[y * RECOG_INPUT_SIZE + x];
                input[0][y][x][0] = (((px >> 16) & 0xFF) - 127.5f) / 128.0f;
                input[0][y][x][1] = (((px >>  8) & 0xFF) - 127.5f) / 128.0f;
                input[0][y][x][2] = (( px        & 0xFF) - 127.5f) / 128.0f;
            }
        return input;
    }

    /**
     * Simple histogram equalization — pure Java, no OpenCV.
     * Improves contrast in harsh outdoor lighting (direct sun / deep shadows).
     *
     * For full CLAHE (Contrast-Limited Adaptive HE), add:
     *   implementation 'org.opencv:opencv:4.8.0'
     * and replace this method with:
     *   CLAHE clahe = Imgproc.createCLAHE(2.0, new Size(8, 8));
     *   clahe.apply(grayMat, enhancedMat);
     */
    private Bitmap applyHistogramEqualization(Bitmap src) {
        int w = src.getWidth(), h = src.getHeight();
        int[] pixels = new int[w * h];
        src.getPixels(pixels, 0, w, 0, 0, w, h);

        int[]   hist = new int[256];
        int[]   luma = new int[pixels.length];
        for (int i = 0; i < pixels.length; i++) {
            int r = (pixels[i] >> 16) & 0xFF;
            int g = (pixels[i] >>  8) & 0xFF;
            int b =  pixels[i]        & 0xFF;
            luma[i] = (int)(0.299f * r + 0.587f * g + 0.114f * b);
            hist[luma[i]]++;
        }

        int[] cdf = new int[256];
        cdf[0] = hist[0];
        for (int i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
        int minCdf = 0;
        for (int v : cdf) { if (v > 0) { minCdf = v; break; } }

        float[] lut = new float[256];
        int n = pixels.length - minCdf;
        for (int i = 0; i < 256; i++)
            lut[i] = n > 0 ? (float)(cdf[i] - minCdf) / n * 255f : i;

        int[] out = new int[pixels.length];
        for (int i = 0; i < pixels.length; i++) {
            float ratio = luma[i] > 0 ? lut[luma[i]] / luma[i] : 1f;
            int   r     = Math.min(255, (int)(((pixels[i] >> 16) & 0xFF) * ratio));
            int   g     = Math.min(255, (int)(((pixels[i] >>  8) & 0xFF) * ratio));
            int   b     = Math.min(255, (int)(( pixels[i]        & 0xFF) * ratio));
            int   a     = (pixels[i] >> 24) & 0xFF;
            out[i] = (a << 24) | (r << 16) | (g << 8) | b;
        }

        Bitmap result = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        result.setPixels(out, 0, w, 0, 0, w, h);
        return result;
    }

    /** Load a TFLite model from the app's assets/ directory into a MappedByteBuffer. */
    private MappedByteBuffer loadModelFile(Context ctx, String filename) throws IOException {
        AssetFileDescriptor afd = ctx.getAssets().openFd(filename);
        FileInputStream     fis = new FileInputStream(afd.getFileDescriptor());
        FileChannel          fc = fis.getChannel();
        return fc.map(FileChannel.MapMode.READ_ONLY, afd.getStartOffset(), afd.getDeclaredLength());
    }

    /** L2-normalise so cosine similarity == dot product. */
    private float[] l2Normalize(float[] vec) {
        float norm = 1e-10f;
        for (float v : vec) norm += v * v;
        norm = (float) Math.sqrt(norm);
        float[] out = new float[vec.length];
        for (int i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
        return out;
    }
}
