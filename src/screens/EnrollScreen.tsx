import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import { useCamera } from '../plugins/useCamera';
import { useDetectAndMesh, DetectResult } from '../plugins/useDetectAndMesh';
import { biometricAuth } from '../modules/BiometricAuth';

interface Props {
  onEnrolled?: (userId: string, userName: string) => void;
  onBack?:     () => void;
}

const POSES = [
  'Look straight at the camera',
  'Tilt head slightly left',
  'Tilt head slightly right',
  'Look up slightly',
  'Look straight again — almost done!',
];
const CAPTURE_NEEDED   = 5;
const CAPTURE_INTERVAL = 1800; // ms between auto-captures

export default function EnrollScreen({ onEnrolled, onBack }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCamera(hasPermission);

  const [step,        setStep]        = useState<'form' | 'capture' | 'processing' | 'done'>('form');
  const [userId,      setUserId]      = useState('');
  const [userName,    setName]        = useState('');
  const [captured,    setCaptured]    = useState(0);
  const [faceOn,      setFaceOn]      = useState(false);
  const [error,       setError]       = useState('');
  const [camActive,   setCamActive]   = useState(false);

  const embeddings    = useRef<Float32Array[]>([]);
  const lastCapMs     = useRef(0);
  const capCountRef   = useRef(0);
  const stepRef       = useRef<typeof step>('form');

  // Keep refs in sync so frame callbacks can read them without stale closures
  useEffect(() => { stepRef.current = step; }, [step]);

  // Samsung black-preview fix: activate camera 400 ms after mount
  useEffect(() => {
    const t = setTimeout(() => setCamActive(true), 400);
    return () => clearTimeout(t);
  }, []);

  // ── Frame processor callback (called on JS thread via useRunOnJS) ─────────
  const handleDetect = useCallback((r: DetectResult | null) => {
    if (stepRef.current !== 'capture') return;

    setFaceOn(r !== null);
    if (!r) return;

    const now = Date.now();
    if (now - lastCapMs.current < CAPTURE_INTERVAL) return;
    if (capCountRef.current >= CAPTURE_NEEDED) return;

    lastCapMs.current = now;
    embeddings.current.push(r.embedding);
    capCountRef.current += 1;
    const n = capCountRef.current;
    setCaptured(n);

    if (n >= CAPTURE_NEEDED) {
      stepRef.current = 'processing';
      setStep('processing');
    }
  }, []);

  const { frameProcessor, isLoading } = useDetectAndMesh(handleDetect);

  // ── Run enrollment when enough frames captured ────────────────────────────
  useEffect(() => {
    if (step !== 'processing') return;

    const embs = embeddings.current.slice();
    biometricAuth.enroll(userId.trim(), userName.trim(), embs)
      .then(() => {
        setStep('done');
        setTimeout(() => onEnrolled?.(userId.trim(), userName.trim()), 1500);
      })
      .catch((e: any) => {
        setError(e?.message ?? 'Enrollment failed');
        setStep('form');
      });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  const startCapture = () => {
    if (!userId.trim())   { Alert.alert('Required', 'Please enter your Employee ID'); return; }
    if (!userName.trim()) { Alert.alert('Required', 'Please enter your name'); return; }
    embeddings.current  = [];
    lastCapMs.current   = 0;
    capCountRef.current = 0;
    setCaptured(0);
    setFaceOn(false);
    setError('');
    setStep('capture');
  };

  // ── Permission gate (after all hooks) ─────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera Access Needed</Text>
        <Text style={styles.permSub}>
          This app needs your camera to capture your face for enrollment.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 72 }}>✅</Text>
        <Text style={styles.doneTitle}>Enrolled!</Text>
        <Text style={styles.doneSub}>{userName.trim()} ({userId.trim()})</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* ── FORM STEP ─────────────────────────────────────────────────────── */}
      {step === 'form' && (
        <View style={styles.formWrap}>
          {onBack && (
            <TouchableOpacity style={styles.backBtn} onPress={onBack}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.title}>Enroll New User</Text>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <TextInput
            style={styles.input}
            placeholder="Employee ID  (e.g. EMP001)"
            placeholderTextColor="#6B7280"
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="characters"
          />
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            placeholderTextColor="#6B7280"
            value={userName}
            onChangeText={setName}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={startCapture}>
            <Text style={styles.btnText}>Start Enrollment</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            The camera will automatically capture {CAPTURE_NEEDED} face poses.
            Follow the on-screen instructions.
          </Text>
        </View>
      )}

      {/* ── CAPTURE / PROCESSING STEP ────────────────────────────────────── */}
      {(step === 'capture' || step === 'processing') && (
        <>
          {/* Camera — always rendered once we reach capture step */}
          {device ? (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={camActive && step === 'capture'}
              video
              frameProcessor={camActive && step === 'capture' && !isLoading ? frameProcessor : undefined}
              fps={15}
              pixelFormat="rgb"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.loadingCam]}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={styles.gray}>Loading camera...</Text>
            </View>
          )}

          <View style={styles.overlay}>
            {/* Progress dots */}
            <View style={styles.dotsRow}>
              {Array.from({ length: CAPTURE_NEEDED }).map((_, i) => (
                <View key={i} style={[styles.dot, i < captured && styles.dotDone]} />
              ))}
            </View>

            {/* Oval guide */}
            <View style={styles.ovalWrap}>
              <View style={[styles.oval, faceOn && styles.ovalActive]} />
            </View>

            {/* Bottom card */}
            <View style={styles.card}>
              {step === 'processing' ? (
                <>
                  <ActivityIndicator size="large" color="#3B82F6" />
                  <Text style={styles.instruction}>Saving face template...</Text>
                </>
              ) : isLoading ? (
                <>
                  <ActivityIndicator size="small" color="#94A3B8" />
                  <Text style={styles.instruction}>Loading AI models...</Text>
                </>
              ) : (
                <>
                  <Text style={styles.poseNum}>{captured}/{CAPTURE_NEEDED} captured</Text>
                  <Text style={styles.instruction}>
                    {faceOn
                      ? POSES[Math.min(captured, POSES.length - 1)]
                      : 'Position your face in the oval'}
                  </Text>
                  {faceOn && (
                    <View style={styles.faceOnBadge}>
                      <Text style={styles.faceOnText}>Face detected — hold still</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', padding: 24, gap: 16 },
  loadingCam:  { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  formWrap:    { flex: 1, justifyContent: 'center', backgroundColor: '#0F172A', padding: 24, gap: 14 },
  backBtn:     { marginBottom: 8 },
  backText:    { color: '#60A5FA', fontSize: 15 },
  title:       { color: '#F8FAFC', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  doneTitle:   { color: '#F8FAFC', fontSize: 26, fontWeight: '700' },
  doneSub:     { color: '#94A3B8', fontSize: 15 },
  permTitle:   { color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub:     { color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  errorText:   { color: '#EF4444', fontSize: 13, textAlign: 'center' },
  hint:        { color: '#6B7280', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  gray:        { color: '#94A3B8', marginTop: 12 },
  input: {
    backgroundColor: '#1E293B',
    borderRadius:    10,
    padding:         14,
    color:           '#F8FAFC',
    fontSize:        16,
    borderWidth:     1,
    borderColor:     '#334155',
  },
  primaryBtn:  { backgroundColor: '#3B82F6', borderRadius: 10, padding: 16, alignItems: 'center' },
  btnText:     { color: '#fff', fontSize: 16, fontWeight: '600' },
  overlay:     { flex: 1, justifyContent: 'space-between' },
  dotsRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:             10,
    paddingTop:      Platform.OS === 'ios' ? 60 : 24,
    paddingBottom:   10,
  },
  dot:         { width: 14, height: 14, borderRadius: 7, backgroundColor: '#334155' },
  dotDone:     { backgroundColor: '#10B981' },
  ovalWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:        { width: 220, height: 280, borderRadius: 110, borderWidth: 3, borderColor: '#475569' },
  ovalActive:  { borderColor: '#3B82F6' },
  card: {
    backgroundColor: 'rgba(15,23,42,0.90)',
    margin:           16,
    padding:          24,
    borderRadius:     16,
    alignItems:       'center',
    gap:              12,
  },
  poseNum:     { color: '#94A3B8', fontSize: 13 },
  instruction: { color: '#F8FAFC', fontSize: 16, textAlign: 'center', fontWeight: '500' },
  faceOnBadge: { backgroundColor: 'rgba(16,185,129,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  faceOnText:  { color: '#10B981', fontSize: 13, fontWeight: '600' },
});
