import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform, ScrollView,
} from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import { useCamera } from '../plugins/useCamera';
import { useDetectAndMesh, DetectResult } from '../plugins/useDetectAndMesh';
import { biometricAuth } from '../modules/BiometricAuth';

// ── Constants ──────────────────────────────────────────────────────────────────
const TOTAL_CAPTURES   = 5;
const CAPTURE_DELAY_MS = 1800; // minimum ms between auto-captures

const POSE_INSTRUCTIONS = [
  'Look straight at the camera',
  'Tilt your head slightly left',
  'Tilt your head slightly right',
  'Look upward slightly',
  'Look straight at the camera again',
];

// ── Types ──────────────────────────────────────────────────────────────────────
type Step = 'form' | 'capture' | 'processing' | 'done';

interface Props {
  onEnrolled?: (userId: string, userName: string) => void;
  onBack?:     () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function EnrollScreen({ onEnrolled, onBack }: Props) {
  // Camera hooks — must be called unconditionally
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCamera(hasPermission);

  // UI state
  const [step,      setStep]      = useState<Step>('form');
  const [userId,    setUserId]    = useState('');
  const [userName,  setUserName]  = useState('');
  const [captured,  setCaptured]  = useState(0);
  const [faceFound, setFaceFound] = useState(false);
  const [error,     setError]     = useState('');
  const [camReady,  setCamReady]  = useState(false);

  // Refs for values accessed inside frame callbacks (avoids stale closures)
  const stepRef       = useRef<Step>('form');
  const captureRef    = useRef(0);
  const lastCaptureTs = useRef(0);
  const embeddings    = useRef<Float32Array[]>([]);

  useEffect(() => { stepRef.current = step; }, [step]);

  // Samsung Galaxy fix: 400ms black-preview workaround
  useEffect(() => {
    const t = setTimeout(() => setCamReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  // ── Frame processor callback ───────────────────────────────────────────────
  const onDetect = useCallback((r: DetectResult | null) => {
    if (stepRef.current !== 'capture') return;

    setFaceFound(r !== null);
    if (!r) return;

    const now = Date.now();
    if (now - lastCaptureTs.current < CAPTURE_DELAY_MS) return;
    if (captureRef.current >= TOTAL_CAPTURES) return;

    lastCaptureTs.current = now;
    embeddings.current.push(r.embedding);
    captureRef.current += 1;

    const n = captureRef.current;
    setCaptured(n);

    if (n >= TOTAL_CAPTURES) {
      stepRef.current = 'processing';
      setStep('processing');
    }
  }, []);

  const { frameProcessor, isLoading } = useDetectAndMesh(onDetect);

  // ── Trigger enrollment after captures complete ─────────────────────────────
  useEffect(() => {
    if (step !== 'processing') return;

    biometricAuth
      .enroll(userId.trim(), userName.trim(), embeddings.current.slice())
      .then(() => {
        setStep('done');
        setTimeout(() => onEnrolled?.(userId.trim(), userName.trim()), 1500);
      })
      .catch((e: any) => {
        setError(e?.message ?? 'Enrollment failed. Please try again.');
        captureRef.current = 0;
        embeddings.current = [];
        setCaptured(0);
        setStep('form');
      });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start capture ──────────────────────────────────────────────────────────
  const startCapture = () => {
    if (!userId.trim())   { Alert.alert('Required', 'Please enter your Employee ID.'); return; }
    if (!userName.trim()) { Alert.alert('Required', 'Please enter your full name.'); return; }
    embeddings.current  = [];
    captureRef.current  = 0;
    lastCaptureTs.current = 0;
    setCaptured(0);
    setFaceFound(false);
    setError('');
    setStep('capture');
  };

  // ── Permission gate ────────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={s.center}>
        <Text style={s.icon}>📷</Text>
        <Text style={s.permTitle}>Camera Access Required</Text>
        <Text style={s.permSub}>
          Camera permission is needed to capture your face for enrollment.
        </Text>
        <TouchableOpacity style={s.primaryBtn} onPress={requestPermission}>
          <Text style={s.primaryBtnText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={s.center}>
        <Text style={s.bigIcon}>✅</Text>
        <Text style={s.successTitle}>Enrollment Complete!</Text>
        <Text style={s.successSub}>{userName.trim()} · {userId.trim()}</Text>
      </View>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  if (step === 'form') {
    return (
      <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
        {onBack && (
          <TouchableOpacity style={s.backBtn} onPress={onBack}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={s.formTitle}>Enroll New User</Text>
        <Text style={s.formSubtitle}>
          The camera will automatically capture {TOTAL_CAPTURES} face poses.
        </Text>
        {!!error && <Text style={s.errorText}>{error}</Text>}

        <Text style={s.label}>EMPLOYEE ID</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. EMP001"
          placeholderTextColor="#475569"
          value={userId}
          onChangeText={setUserId}
          autoCapitalize="characters"
          returnKeyType="next"
        />

        <Text style={s.label}>FULL NAME</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. Ravi Kumar"
          placeholderTextColor="#475569"
          value={userName}
          onChangeText={setUserName}
          returnKeyType="done"
        />

        <TouchableOpacity style={s.primaryBtn} onPress={startCapture} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>Start Face Capture</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Capture / Processing ───────────────────────────────────────────────────
  return (
    <View style={s.cameraContainer}>
      {/* Camera preview */}
      {device ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={camReady && step === 'capture'}
          video
          frameProcessor={camReady && step === 'capture' && !isLoading ? frameProcessor : undefined}
          fps={15}
          pixelFormat="rgb"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.center]}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={s.grayText}>Initializing camera...</Text>
        </View>
      )}

      {/* Overlay UI */}
      <View style={s.overlay}>
        {/* Progress dots */}
        <View style={s.dotsRow}>
          {Array.from({ length: TOTAL_CAPTURES }).map((_, i) => (
            <View key={i} style={[s.dot, i < captured && s.dotFilled]} />
          ))}
        </View>

        {/* Oval guide */}
        <View style={s.ovalWrapper}>
          <View style={[s.oval, faceFound && s.ovalActive]} />
        </View>

        {/* Status card */}
        <View style={s.card}>
          {step === 'processing' ? (
            <>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={s.cardTitle}>Saving face template...</Text>
            </>
          ) : isLoading ? (
            <>
              <ActivityIndicator size="small" color="#94A3B8" />
              <Text style={s.cardTitle}>Loading AI models...</Text>
            </>
          ) : (
            <>
              <Text style={s.captureCount}>{captured} / {TOTAL_CAPTURES} captured</Text>
              <Text style={s.cardTitle}>
                {faceFound
                  ? POSE_INSTRUCTIONS[Math.min(captured, POSE_INSTRUCTIONS.length - 1)]
                  : 'Position your face inside the oval'}
              </Text>
              {faceFound && (
                <View style={s.facePill}>
                  <Text style={s.facePillText}>Face detected — hold still</Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', padding: 28, gap: 16 },
  icon:         { fontSize: 48 },
  bigIcon:      { fontSize: 80, marginBottom: 8 },
  permTitle:    { color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub:      { color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  successTitle: { color: '#F8FAFC', fontSize: 24, fontWeight: '700' },
  successSub:   { color: '#94A3B8', fontSize: 15 },
  grayText:     { color: '#94A3B8', marginTop: 12, fontSize: 14 },

  formScroll: {
    flexGrow:        1,
    backgroundColor: '#0F172A',
    padding:          24,
    paddingTop:       Platform.OS === 'ios' ? 60 : 32,
    gap:              14,
  },
  backBtn:      { marginBottom: 4 },
  backText:     { color: '#60A5FA', fontSize: 15 },
  formTitle:    { color: '#F8FAFC', fontSize: 24, fontWeight: '700' },
  formSubtitle: { color: '#94A3B8', fontSize: 14, lineHeight: 21 },
  errorText:    { color: '#EF4444', fontSize: 13, backgroundColor: '#1F0A0A', padding: 12, borderRadius: 8 },
  label:        { color: '#64748B', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  input: {
    backgroundColor: '#1E293B',
    borderRadius:     10,
    padding:          14,
    color:            '#F8FAFC',
    fontSize:         16,
    borderWidth:      1,
    borderColor:      '#334155',
    marginBottom:      4,
  },
  primaryBtn:     { backgroundColor: '#3B82F6', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  cameraContainer: { flex: 1, backgroundColor: '#000' },
  overlay:         { flex: 1, justifyContent: 'space-between' },
  dotsRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:             10,
    paddingTop:      Platform.OS === 'ios' ? 60 : 28,
    paddingBottom:   10,
  },
  dot:       { width: 14, height: 14, borderRadius: 7, backgroundColor: '#1E293B', borderWidth: 2, borderColor: '#334155' },
  dotFilled: { backgroundColor: '#10B981', borderColor: '#10B981' },
  ovalWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:        { width: 220, height: 280, borderRadius: 110, borderWidth: 3, borderColor: '#475569' },
  ovalActive:  { borderColor: '#3B82F6', borderWidth: 4 },
  card: {
    backgroundColor: 'rgba(15,23,42,0.92)',
    margin:           16,
    padding:          24,
    borderRadius:     20,
    alignItems:       'center',
    gap:              10,
  },
  captureCount: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  cardTitle:    { color: '#F8FAFC', fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 24 },
  facePill:     { backgroundColor: 'rgba(16,185,129,0.15)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  facePillText: { color: '#10B981', fontSize: 13, fontWeight: '600' },
});
