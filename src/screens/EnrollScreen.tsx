import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { useCamera } from '../plugins/useCamera';
import { useDetectAndMesh, DetectResult } from '../plugins/useDetectAndMesh';
import { biometricAuth } from '../modules/BiometricAuth';

const CAPTURE_COUNT = 5;
const CAPTURE_INTERVAL_MS = 1800;

interface Props {
  userId: string;
  userName: string;
  onDone: () => void;
  onCancel: () => void;
}

export default function EnrollScreen({ userId, userName, onDone, onCancel }: Props) {
  const { hasPermission, requestPermission } = Camera.useCameraPermission();
  const device = useCamera(hasPermission);

  const [step, setStep] = useState<'camera' | 'processing' | 'done' | 'error'>('camera');
  const [faceFound, setFaceFound] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [camReady, setCamReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const stepRef = useRef<'camera' | 'processing' | 'done' | 'error'>('camera');
  const captureRef = useRef<Float32Array[]>([]);
  const lastCaptureTs = useRef(0);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    const timer = setTimeout(() => setCamReady(true), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (step !== 'processing') return;
    stepRef.current = 'processing';

    biometricAuth
      .enroll(userId, userName, captureRef.current)
      .then(() => {
        setStep('done');
        stepRef.current = 'done';
      })
      .catch(() => {
        setErrorMsg('Enrollment failed. Please try again.');
        setStep('error');
        stepRef.current = 'error';
      });
  }, [step, userId, userName]);

  const onDetect = useCallback((result: DetectResult | null) => {
    if (stepRef.current !== 'camera') return;

    setFaceFound(!!result?.faceFound);

    if (!result?.embedding) return;

    const now = Date.now();
    if (now - lastCaptureTs.current < CAPTURE_INTERVAL_MS) return;
    lastCaptureTs.current = now;

    captureRef.current.push(result.embedding);
    const count = captureRef.current.length;
    setCaptureCount(count);

    if (count >= CAPTURE_COUNT) {
      setStep('processing');
      stepRef.current = 'processing';
    }
  }, []);

  const { frameProcessor, isLoading } = useDetectAndMesh(onDetect);

  if (step === 'done') {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.successIcon}>✓</Text>
        <Text style={s.successText}>Enrolled!</Text>
        <Text style={s.subText}>{userName} has been registered.</Text>
        <TouchableOpacity style={s.btn} onPress={onDone}>
          <Text style={s.btnText}>Continue</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (step === 'error') {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.errorText}>{errorMsg}</Text>
        <TouchableOpacity style={s.btn} onPress={onCancel}>
          <Text style={s.btnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (step === 'processing') {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={s.subText}>Processing enrollment...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Enroll Face</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={s.cameraWrap}>
        {device && camReady && !isLoading ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={true}
            frameProcessor={frameProcessor}
            pixelFormat="rgb"
            photo={false}
            video={false}
          />
        ) : (
          <View style={s.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={s.loadingText}>
              {isLoading ? 'Loading models...' : 'Starting camera...'}
            </Text>
          </View>
        )}

        <View style={s.ovalBorder} />

        {faceFound && (
          <View style={s.facePill}>
            <Text style={s.facePillText}>Face detected</Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        <Text style={s.instruction}>
          Hold still — capturing {captureCount}/{CAPTURE_COUNT}
        </Text>
        <View style={s.dots}>
          {Array.from({ length: CAPTURE_COUNT }).map((_, i) => (
            <View key={i} style={[s.dot, i < captureCount && s.dotFilled]} />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', padding: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cancelText: { color: '#4CAF50', fontSize: 16 },
  cameraWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
  loadingOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 14 },
  ovalBorder: {
    position: 'absolute', top: '10%', left: '10%', right: '10%', bottom: '10%',
    borderRadius: 200, borderWidth: 3, borderColor: '#4CAF50',
  },
  facePill: {
    position: 'absolute', bottom: 16, alignSelf: 'center',
    backgroundColor: 'rgba(76,175,80,0.85)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6,
  },
  facePillText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  footer: { padding: 24, alignItems: 'center' },
  instruction: { color: '#ccc', fontSize: 16, marginBottom: 16 },
  dots: { flexDirection: 'row', gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#444', borderWidth: 1, borderColor: '#4CAF50' },
  dotFilled: { backgroundColor: '#4CAF50' },
  successIcon: { fontSize: 72, color: '#4CAF50', marginBottom: 16 },
  successText: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subText: { color: '#aaa', fontSize: 16, marginBottom: 32, textAlign: 'center' },
  btn: { backgroundColor: '#4CAF50', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  errorText: { color: '#f44336', fontSize: 18, marginBottom: 32, textAlign: 'center' },
});
