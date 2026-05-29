import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import {
  Camera, useCameraDevices, useCameraPermission,
} from 'react-native-vision-camera';
import { biometricAuth } from '../modules/BiometricAuth';

interface Props {
  onEnrolled?: (userId: string) => void;
}

const INSTRUCTIONS = [
  'Look straight at camera',
  'Tilt head slightly left',
  'Tilt head slightly right',
  'Look up slightly',
  'Look straight again',
];
const FRAMES_NEEDED = 5;

export default function EnrollScreen({ onEnrolled }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const device  = devices.find(d => d.position === 'front') ?? devices[0];

  const [step,     setStep]    = useState<'form' | 'capture' | 'processing' | 'done'>('form');
  const [userId,   setUserId]  = useState('');
  const [userName, setName]    = useState('');
  const [captured, setCaptured]= useState(0);
  const [message,  setMessage] = useState('');
  const [error,    setError]   = useState('');

  const frames = useRef<Array<{ rgba: Uint8Array; width: number; height: number }>>([]);

  // ── Permission gate ────────────────────────────────────────────────────
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

  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading camera...</Text>
        <Text style={styles.hint}>
          {devices.length === 0
            ? 'No cameras found. Try reopening the app.'
            : `Found ${devices.length} camera(s), selecting...`}
        </Text>
      </View>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────
  const startCapture = () => {
    if (!userId.trim())   { Alert.alert('Required', 'Please enter Employee ID.'); return; }
    if (!userName.trim()) { Alert.alert('Required', 'Please enter your name.'); return; }
    frames.current = [];
    setCaptured(0);
    setMessage(INSTRUCTIONS[0]);
    setError('');
    setStep('capture');
  };

  const captureFrame = () => {
    // Stub frame — replace with real camera capture for production
    const stub = { rgba: new Uint8Array(112 * 112 * 4), width: 112, height: 112 };
    frames.current.push(stub);
    const n = frames.current.length;
    setCaptured(n);
    if (n < FRAMES_NEEDED) {
      setMessage(INSTRUCTIONS[n]);
    } else {
      enroll();
    }
  };

  const enroll = async () => {
    setStep('processing');
    setMessage('Saving enrollment...');
    try {
      await biometricAuth.enroll(userId.trim(), userName.trim(), frames.current);
      setStep('done');
      setMessage(`${userName.trim()} enrolled!`);
      setTimeout(() => onEnrolled?.(userId.trim()), 1500);
    } catch (e: any) {
      setError(e.message);
      setStep('form');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* FORM step */}
      {step === 'form' && (
        <View style={styles.formWrap}>
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
            <Text style={styles.btnText}>Start Capture ({FRAMES_NEEDED} poses)</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            You'll capture {FRAMES_NEEDED} poses for a robust face template.
          </Text>
        </View>
      )}

      {/* CAPTURE / PROCESSING step */}
      {(step === 'capture' || step === 'processing') && (
        <>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            fps={15}
          />
          <View style={styles.overlay}>
            {/* Progress dots */}
            <View style={styles.dotsRow}>
              {Array.from({ length: FRAMES_NEEDED }).map((_, i) => (
                <View key={i} style={[styles.dot, i < captured && styles.dotDone]} />
              ))}
            </View>

            {/* Oval guide */}
            <View style={styles.ovalWrap}>
              <View style={styles.oval} />
            </View>

            {/* Bottom card */}
            <View style={styles.card}>
              <Text style={styles.instruction}>{message}</Text>
              {step === 'capture' && (
                <TouchableOpacity style={styles.captureBtn} onPress={captureFrame}>
                  <View style={styles.captureInner} />
                </TouchableOpacity>
              )}
              {step === 'processing' && (
                <ActivityIndicator size="large" color="#3B82F6" />
              )}
            </View>
          </View>
        </>
      )}

      {/* DONE step */}
      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.title}>{message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0F172A' },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  formWrap:     { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  title:        { color: '#F8FAFC', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  doneIcon:     { fontSize: 72, marginBottom: 8 },
  permTitle:    { color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub:      { color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  loadingText:  { color: '#94A3B8', marginTop: 12 },
  errorText:    { color: '#EF4444', fontSize: 13, textAlign: 'center' },
  hint:         { color: '#6B7280', fontSize: 13, textAlign: 'center', lineHeight: 20 },
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
    flexDirection:   'row',
    justifyContent:  'center',
    gap:             10,
    paddingTop:      Platform.OS === 'ios' ? 60 : 20,
    paddingBottom:   10,
  },
  dot:         { width: 14, height: 14, borderRadius: 7, backgroundColor: '#334155' },
  dotDone:     { backgroundColor: '#10B981' },
  ovalWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:        { width: 220, height: 280, borderRadius: 110, borderWidth: 3, borderColor: '#3B82F6' },
  card: {
    backgroundColor: 'rgba(15,23,42,0.85)',
    margin:          16,
    padding:         24,
    borderRadius:    16,
    alignItems:      'center',
    gap:             16,
  },
  instruction:  { color: '#F8FAFC', fontSize: 16, textAlign: 'center', fontWeight: '500' },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  captureInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
});
