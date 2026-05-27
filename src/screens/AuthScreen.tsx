/**
 * AuthScreen.tsx
 *
 * Authentication screen with:
 *   - Live camera feed (react-native-vision-camera)
 *   - Face oval guide overlay
 *   - Liveness challenge prompts
 *   - Auth result display
 *   - Sync status indicator
 *
 * TODO for Claude Code:
 *   - Implement detectAndMesh() as a VisionCamera frame processor plugin (native)
 *   - Add GPS permission + location fetch before logAttendance()
 *   - Test on physical device (emulator camera won't work for real faces)
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform
} from 'react-native';
import {
  Camera,
  useCameraDevice,
} from 'react-native-vision-camera';
import { biometricAuth, AuthPhase, AuthEvent } from '../modules/BiometricAuth';
import { syncManager, SyncResult }             from '../storage/syncManager';
import { useDetectAndMesh, DetectAndMeshResult } from '../plugins/useDetectAndMesh';

// ─── Challenge prompt text ──────────────────────────────────────────────────
const CHALLENGE_PROMPT: Record<string, string> = {
  BLINK:       '👁  Blink your eyes',
  SMILE:       '😊  Give us a smile',
  TURN_LEFT:   '←  Turn your head left',
  TURN_RIGHT:  '→  Turn your head right',
};

const PHASE_COLORS: Record<AuthPhase, string> = {
  IDLE:          '#6B7280',
  DETECTING_FACE:'#3B82F6',
  LIVENESS:      '#F59E0B',
  RECOGNIZING:   '#8B5CF6',
  SUCCESS:       '#10B981',
  FAILED:        '#EF4444',
  ENROLLING:     '#3B82F6',
  ENROLLED:      '#10B981',
};

// ─── Props ─────────────────────────────────────────────────────────────────
interface AuthScreenProps {
  userId:   string;
  onSuccess?: () => void;
  onFailed?:  () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function AuthScreen({ userId, onSuccess, onFailed }: AuthScreenProps) {
  const device = useCameraDevice('front');

  const [phase,   setPhase]   = useState<AuthPhase>('IDLE');
  const [message, setMessage] = useState('Initializing...');
  const [sim,     setSim]     = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const isActive = !['SUCCESS', 'FAILED', 'IDLE'].includes(phase);

  // ─── Auth event handler ───────────────────────────────────────────────
  const handleAuthEvent = useCallback((event: AuthEvent) => {
    setPhase(event.phase);
    setMessage(
      event.challenge
        ? CHALLENGE_PROMPT[event.challenge] ?? event.message
        : event.message
    );
    if (event.similarity !== undefined) setSim(event.similarity);
    if (event.phase === 'SUCCESS') onSuccess?.();
    if (event.phase === 'FAILED')  onFailed?.();
  }, [onSuccess, onFailed]);

  const handleSyncComplete = useCallback(async (result: SyncResult) => {
    setSyncing(false);
    const count = await syncManager.getPendingCount();
    setPending(count);
    if (result.synced > 0) {
      Alert.alert('Sync complete', `${result.synced} records uploaded, ${result.purged} purged locally.`);
    }
  }, []);

  // ─── Frame processor (BlazeFace + FaceMesh, runs entirely in worklet) ───
  // Must be declared before the useEffects that reference modelsLoading.
  const handleDetectResult = useCallback(
    (result: DetectAndMeshResult | null) => {
      biometricAuth.processAuthFrame({
        userId,
        landmarks:   result?.landmarks  ?? null,
        faceRGBA:    result?.faceRGBA   ?? null,
        faceWidth:   result?.faceWidth  ?? 0,
        faceHeight:  result?.faceHeight ?? 0,
      });
    },
    [userId]
  );

  const { frameProcessor, isLoading: modelsLoading } =
    useDetectAndMesh(handleDetectResult);

  // ─── Init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const initSystem = async () => {
      await biometricAuth.initialize();
      const off = biometricAuth.on(handleAuthEvent);
      syncManager.startListening(handleSyncComplete);
      const count = await syncManager.getPendingCount();
      setPending(count);
      if (!modelsLoading) setMessage('Position your face in the oval');
      return off;
    };

    let cleanup: (() => void) | undefined;
    initSystem().then(off => { cleanup = off; });

    return () => {
      cleanup?.();
      syncManager.stopListening();
    };
  }, []);

  useEffect(() => {
    if (modelsLoading) setMessage('Loading AI models...');
    else if (phase === 'IDLE') setMessage('Position your face in the oval');
  }, [modelsLoading, phase]);

  // ─── Manual sync button ───────────────────────────────────────────────
  const handleManualSync = async () => {
    setSyncing(true);
    const result = await syncManager.forceSyncNow();
    if (!result.success) {
      setSyncing(false);
      Alert.alert('Sync failed', result.error ?? 'Unknown error');
    }
  };

  const handleRetry = () => {
    biometricAuth.reset();
    setPhase('DETECTING_FACE');
    setSim(null);
    setMessage('Position your face in the oval');
  };

  // ─── Render ───────────────────────────────────────────────────────────
  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading camera...</Text>
      </View>
    );
  }

  const statusColor = PHASE_COLORS[phase];

  return (
    <View style={styles.container}>
      {/* Camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={isActive ? frameProcessor : undefined}
        fps={15}
        pixelFormat="rgb"
      />

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.appName}>DataLake Biometric</Text>
          <TouchableOpacity onPress={handleManualSync} disabled={syncing}>
            <View style={[styles.syncBadge, pending > 0 ? styles.syncPending : styles.syncClear]}>
              {syncing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.syncText}>
                    {pending > 0 ? `⬆ ${pending} pending` : '✓ Synced'}
                  </Text>
              }
            </View>
          </TouchableOpacity>
        </View>

        {/* Face oval guide */}
        <View style={styles.ovalContainer}>
          <View style={[styles.oval, { borderColor: statusColor }]} />
        </View>

        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusText}>{message}</Text>

          {sim !== null && (
            <Text style={styles.simScore}>
              Confidence: {(sim * 100).toFixed(1)}%
            </Text>
          )}

          {(phase === 'SUCCESS' || phase === 'FAILED') && (
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
              <Text style={styles.retryText}>
                {phase === 'SUCCESS' ? 'Authenticate Again' : 'Retry'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 14 },
  overlay:     { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        16,
    paddingTop:     Platform.OS === 'ios' ? 56 : 16,
    backgroundColor:'rgba(0,0,0,0.4)',
  },
  appName:    { color: '#fff', fontSize: 17, fontWeight: '600' },
  syncBadge:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  syncPending:{ backgroundColor: '#F59E0B' },
  syncClear:  { backgroundColor: '#10B981' },
  syncText:   { color: '#fff', fontSize: 12, fontWeight: '600' },
  ovalContainer: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
  },
  oval: {
    width:        240,
    height:       300,
    borderRadius: 120,
    borderWidth:  3,
    borderColor:  '#3B82F6',
  },
  statusCard: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    margin:           16,
    padding:          20,
    borderRadius:     16,
    alignItems:       'center',
    gap:              8,
  },
  statusDot: {
    width:        10,
    height:       10,
    borderRadius: 5,
    marginBottom: 4,
  },
  statusText: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '500' },
  simScore:   { color: '#9CA3AF', fontSize: 13 },
  retryButton:{
    marginTop:    8,
    backgroundColor:'#3B82F6',
    paddingHorizontal: 24,
    paddingVertical:    10,
    borderRadius:       10,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
