/**
 * EnrollScreen.tsx
 *
 * Enrollment screen: captures 5 frames with slight pose variation,
 * averages embeddings for a robust enrolled template, then stores
 * AES-256 encrypted in SQLite.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Platform, Alert
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { biometricAuth } from '../modules/BiometricAuth';

const FRAMES_NEEDED = 5;
const INSTRUCTIONS  = [
  'Look straight ahead',
  'Tilt head slightly left',
  'Tilt head slightly right',
  'Look up slightly',
  'Look straight ahead again',
];

interface EnrollScreenProps {
  onEnrolled?: (userId: string) => void;
}

export default function EnrollScreen({ onEnrolled }: EnrollScreenProps) {
  const device = useCameraDevice('front');

  const [step,     setStep]    = useState<'form' | 'capture' | 'processing' | 'done'>('form');
  const [userId,   setUserId]  = useState('');
  const [userName, setName]    = useState('');
  const [captured, setCaptured]= useState(0);
  const [message,  setMessage] = useState('');

  const framesRef = useRef<Array<{ rgba: Uint8Array; width: number; height: number }>>([]);

  const handleStartCapture = () => {
    if (!userId.trim() || !userName.trim()) {
      Alert.alert('Required', 'Please enter both Employee ID and Name.');
      return;
    }
    framesRef.current = [];
    setStep('capture');
    setMessage(INSTRUCTIONS[0]);
  };

  const captureFrame = () => {
    // TODO: Capture current frame from camera ref and push to framesRef.current
    // Stub: push an empty frame for structure testing
    const stubFrame = { rgba: new Uint8Array(112 * 112 * 4), width: 112, height: 112 };
    framesRef.current.push(stubFrame);
    const next = framesRef.current.length;
    setCaptured(next);

    if (next < FRAMES_NEEDED) {
      setMessage(INSTRUCTIONS[next]);
    } else {
      handleEnroll();
    }
  };

  const handleEnroll = async () => {
    setStep('processing');
    setMessage('Processing enrollment...');
    try {
      await biometricAuth.enroll(userId.trim(), userName.trim(), framesRef.current);
      setStep('done');
      setMessage(`${userName} enrolled successfully!`);
      onEnrolled?.(userId.trim());
    } catch (err: any) {
      setStep('form');
      Alert.alert('Enrollment Failed', err.message);
    }
  };

  if (!device) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      {step === 'form' && (
        <View style={styles.formContainer}>
          <Text style={styles.title}>Enroll New User</Text>
          <TextInput
            style={styles.input}
            placeholder="Employee ID"
            placeholderTextColor="#9CA3AF"
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="characters"
          />
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            placeholderTextColor="#9CA3AF"
            value={userName}
            onChangeText={setName}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleStartCapture}>
            <Text style={styles.btnText}>Start Enrollment</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            You will be asked to capture {FRAMES_NEEDED} frames with slight head movement
            for a robust face template.
          </Text>
        </View>
      )}

      {(step === 'capture' || step === 'processing') && (
        <>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={step === 'capture'}
            fps={15}
          />
          <View style={styles.overlay}>
            <View style={styles.progressRow}>
              {Array.from({ length: FRAMES_NEEDED }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i < captured ? styles.dotFilled : styles.dotEmpty]}
                />
              ))}
            </View>
            <View style={styles.ovalContainer}>
              <View style={styles.oval} />
            </View>
            <View style={styles.bottomCard}>
              <Text style={styles.instruction}>{message}</Text>
              {step === 'capture' && (
                <TouchableOpacity style={styles.captureBtn} onPress={captureFrame}>
                  <View style={styles.captureInner} />
                </TouchableOpacity>
              )}
              {step === 'processing' && <ActivityIndicator color="#3B82F6" size="large" />}
            </View>
          </View>
        </>
      )}

      {step === 'done' && (
        <View style={styles.formContainer}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.title}>{message}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { setStep('form'); setUserId(''); setName(''); setCaptured(0); }}
          >
            <Text style={styles.btnText}>Enroll Another</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#111' },
  formContainer:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  title:          { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  successIcon:    { fontSize: 64 },
  input: {
    width:           '100%',
    backgroundColor: '#1F2937',
    borderRadius:     10,
    padding:          14,
    color:            '#fff',
    fontSize:         16,
    borderWidth:      1,
    borderColor:      '#374151',
  },
  primaryBtn:    { width: '100%', backgroundColor: '#3B82F6', borderRadius: 10, padding: 16, alignItems: 'center' },
  btnText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint:          { color: '#6B7280', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  overlay:       { flex: 1, justifyContent: 'space-between' },
  progressRow:   { flexDirection: 'row', justifyContent: 'center', gap: 8, padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 20 },
  dot:           { width: 12, height: 12, borderRadius: 6 },
  dotFilled:     { backgroundColor: '#10B981' },
  dotEmpty:      { backgroundColor: '#374151' },
  ovalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:          { width: 240, height: 300, borderRadius: 120, borderWidth: 3, borderColor: '#3B82F6' },
  bottomCard:    { backgroundColor: 'rgba(0,0,0,0.7)', margin: 16, padding: 20, borderRadius: 16, alignItems: 'center', gap: 16 },
  instruction:   { color: '#fff', fontSize: 16, textAlign: 'center' },
  captureBtn:    { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  captureInner:  { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
});
