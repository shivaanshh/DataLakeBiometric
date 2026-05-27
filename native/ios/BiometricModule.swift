/**
 * BiometricModule.swift
 *
 * iOS native module for TFLite inference + MediaPipe FaceLandmarker.
 *
 * TODOs for Claude Code:
 *  1. Add to ios/Podfile:
 *       pod 'TensorFlowLiteSwift', '~> 2.14.0'
 *       pod 'MediaPipeTasksVision', '~> 0.10.14'
 *
 *  2. Add model files to the Xcode project (drag into Resources, copy if needed):
 *       blazeface.tflite
 *       facemesh.tflite
 *       mobilefacenet_int8.tflite
 *
 *  3. Add camera permission to Info.plist:
 *       NSCameraUsageDescription → "Required for face recognition authentication"
 *
 *  4. Register the module in AppDelegate.m or RCTBridge setup.
 *
 *  5. Uncomment TFLiteSwift + MediaPipe imports after pod install.
 */

import Foundation
import UIKit
// TODO: import TensorFlowLite
// TODO: import MediaPipeTasksVision

@objc(BiometricModule)
class BiometricModule: NSObject {

  // TFLite interpreters
  // private var blazeFaceInterp:  Interpreter?
  // private var faceRecogInterp:  Interpreter?
  // private var faceLandmarker:   FaceLandmarker?

  private var isInitialized = false

  static let FACE_DET_INPUT_SIZE   = 128
  static let FACE_RECOG_INPUT_SIZE = 112
  static let EMBED_DIM             = 128

  // ─── Module registration ───────────────────────────────────────────────
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  // ─── Initialize ─────────────────────────────────────────────────────────
  @objc func initialize(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      /*
       * TODO: Initialize TFLite interpreters
       *
       * let blazeFaceURL  = Bundle.main.url(forResource: "blazeface",         withExtension: "tflite")!
       * let faceRecogURL  = Bundle.main.url(forResource: "mobilefacenet_int8", withExtension: "tflite")!
       *
       * var options = Interpreter.Options()
       * options.threadCount = 2
       *
       * blazeFaceInterp = try Interpreter(modelPath: blazeFaceURL.path, options: options)
       * faceRecogInterp = try Interpreter(modelPath: faceRecogURL.path, options: options)
       * try blazeFaceInterp?.allocateTensors()
       * try faceRecogInterp?.allocateTensors()
       *
       * // MediaPipe FaceLandmarker
       * let baseOptions = BaseOptions(modelAssetPath: "facemesh.tflite")
       * let options     = FaceLandmarkerOptions()
       * options.baseOptions              = baseOptions
       * options.runningMode             = .image
       * options.numFaces                 = 1
       * options.minFaceDetectionConfidence = 0.5
       * options.minFacePresenceConfidence  = 0.5
       * options.minTrackingConfidence      = 0.5
       * faceLandmarker = try FaceLandmarker(options: options)
       */

      isInitialized = true
      print("[BiometricModule] Initialized (stub)")
      resolve(true)
    } catch {
      reject("INIT_FAILED", error.localizedDescription, error)
    }
  }

  // ─── Face detection ──────────────────────────────────────────────────────
  @objc func detectFace(_ frameBase64: String,
                        width: Int,
                        height: Int,
                        resolver resolve: RCTPromiseResolveBlock,
                        rejecter reject: RCTPromiseRejectBlock) {
    guard isInitialized else {
      reject("NOT_INIT", "Call initialize() first", nil); return
    }

    /*
     * TODO: Run BlazeFace
     *
     * guard let data = Data(base64Encoded: frameBase64),
     *       let uiImg = UIImage(data: data),
     *       let cgImg  = uiImg.cgImage else {
     *   reject("DECODE_FAIL", "Could not decode frame", nil); return
     * }
     *
     * let resized = resize(cgImg, to: CGSize(width: 128, height: 128))
     * var inputData = clahePreprocess(resized)
     *
     * try? blazeFaceInterp?.copy(inputData, toInputAt: 0)
     * try? blazeFaceInterp?.invoke()
     *
     * let outputTensor = try? blazeFaceInterp?.output(at: 0)
     * // Parse [x1, y1, x2, y2, score] from outputTensor.data
     */

    // Stub response
    resolve(["x1": 0.2, "y1": 0.1, "x2": 0.8, "y2": 0.9, "score": 0.99])
  }

  // ─── Face embedding ──────────────────────────────────────────────────────
  @objc func getEmbedding(_ faceBase64: String,
                          width: Int,
                          height: Int,
                          resolver resolve: RCTPromiseResolveBlock,
                          rejecter reject: RCTPromiseRejectBlock) {
    guard isInitialized else {
      reject("NOT_INIT", "Call initialize() first", nil); return
    }

    /*
     * TODO: Run MobileFaceNet
     *
     * guard let data = Data(base64Encoded: faceBase64),
     *       let uiImg = UIImage(data: data),
     *       let cgImg  = uiImg.cgImage else {
     *   reject("DECODE_FAIL", "Could not decode face", nil); return
     * }
     *
     * let resized    = resize(cgImg, to: CGSize(width: 112, height: 112))
     * var inputData  = normalizeForMobileFaceNet(resized) // (pixel - 127.5) / 128
     *
     * try? faceRecogInterp?.copy(inputData, toInputAt: 0)
     * try? faceRecogInterp?.invoke()
     *
     * let outputTensor = try? faceRecogInterp?.output(at: 0)
     * var rawEmbed     = [Float](repeating: 0, count: 128)
     * outputTensor?.data.copyBytes(to: &rawEmbed, count: 128 * 4)
     * let normalized   = l2Normalize(rawEmbed)
     * resolve(normalized)
     */

    // Stub: return zeroed embedding
    resolve(Array(repeating: 0.0, count: Self.EMBED_DIM))
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private func l2Normalize(_ vec: [Float]) -> [Float] {
    let norm = sqrt(vec.map { $0 * $0 }.reduce(0, +)) + 1e-10
    return vec.map { $0 / norm }
  }
}

// ─── Objective-C bridge ───────────────────────────────────────────────────
@objc(BiometricModuleBridge)
class BiometricModuleBridge: NSObject {}
