import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import {
  Camera, useCameraPermission,
} from 'react-native-vision-camera';
import { useCamera } from '../plugins/useCamera';
import { biometricAuth, AuthPhase, AuthEvent } from '../modules/BiometricAuth';
import { syncManager, SyncResult }             from '../storage/syncManager';
import { useDetectAndMesh, DetectResult }       from '../plugins/useDetectAndMesh';

interface Props {
  userId:    string;
  onSuccess?: () => void;
  onFailed?:  () => void;
}

const PHASE_COLOR: Record<AuthPhase, string> = {
  IDLE:           '#6B7280',
  DETECTING_FACE: '#3B82F6',
  LIVENESS:       '#F59E0B',
  RECOGNIZING:    '#8B5CF6',
  SUCCESS:        '#10B981',
  FAILED:         '#EF4444',
  ENROLLING:      '#3B82F6',
  ENROLLED:       '#10B981',
};

const CHALLENGE_LABEL: Record<string, string> = {
  BLINK:      '👁  Please blink',
  SMILE:      '😊  Please smile',
  TURN_LEFT:  '←  Turn head left',
  TURN_RIGHT: '→  Turn head right',
};

export default function AuthScreen({ userId, onSuccess, onFailed }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const { device } = useCamera();

  const [phase,   setPhase]   = useState<AuthPhase>('IDLE');
  const [message, setMessage] = useState('Initializing...');
  const [sim,     setSim]     = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const isActive = !['SUCCESS', 'FAILED'].includes(phase);

  // ── Event handler ──────────────────────────────────────────────────────
  const handleEvent = useCallback((e: AuthEvent) => {
    setPhase(e.phase);
    setMessage(e.challenge ? (CHALLENGE_LABEL[e.challenge] ?? e.message) : e.message);
    if (e.similarity !== undefined) setSim(e.similarity);
    if (e.phase === 'SUCCESS') onSuccess?.();
    if (e.phase === 'FAILED')  onFailed?.();
  }, [onSuccess, onFailed]);

  // ── Frame result handler (called from worklet via useRunOnJS) ──────────
  const handleDetect = useCallback((r: DetectResult | null) => {
    biometricAuth.processAuthFrame({
      userId,
      landmarks:  r?.landmarks  ?? null,
      faceRGBA:   r?.faceRGBA   ?? null,
      faceWidth:  r?.faceWidth  ?? 0,
      faceHeight: r?.faceHeight ?? 0,
    });
  }, [userId]);

  // useDetectAndMesh MUST be called before any conditional returns that
  // depend on its output, to avoid violating Rules of Hooks.
  const { frameProcessor, isLoading } = useDetectAndMesh(handleDetect);

  // ── Init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const off = biometricAuth.on(handleEvent);
    syncManager.startListening(async (result: SyncResult) => {
      setSyncing(false);
      setPending(await syncManager.getPendingCount());
      if (result.synced > 0) Alert.alert('Sync complete', `${result.synced} records uploaded.`);
    });
    syncManager.getPendingCount().then(setPending);
    return () => {
      off();
      syncManager.stopListening();
    };
  }, [handleEvent]);

  useEffect(() => {
    if (isLoading) setMessage('Loading AI models...');
    else           setMessage('Position your face in the oval');
  }, [isLoading]);

  // ── Permission gate ────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera Access Needed</Text>
        <Text style={styles.permSub}>Camera permission is required for face authentication.</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={requestPermission}>
          <Text style={styles.actionText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.gray}>Loading camera...</Text>
      </View>
    );
  }

  const color = PHASE_COLOR[phase];

  return (
    <View style={styles.container}>
      {/* Camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={isActive && !isLoading ? frameProcessor : undefined}
        fps={15}
        pixelFormat="rgb"
      />

      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.appName}>DataLake Biometric</Text>
          <TouchableOpacity
            onPress={async () => { setSyncing(true); await syncManager.forceSyncNow(); }}
            disabled={syncing}
          >
            <View style={[styles.syncBadge, pending > 0 ? styles.syncPending : styles.syncOk]}>
              {syncing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.syncText}>{pending > 0 ? `⬆ ${pending}` : '✓ Synced'}</Text>
              }
            </View>
          </TouchableOpacity>
        </View>

        {/* Oval guide */}
        <View style={styles.ovalWrap}>
          <View style={[styles.oval, { borderColor: color }]} />
        </View>

        {/* Status card */}
        <View style={styles.card}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={styles.statusText}>{message}</Text>
          {sim !== null && (
            <Text style={styles.simText}>Confidence: {(sim * 100).toFixed(1)}%</Text>
          )}
          {(phase === 'SUCCESS' || phase === 'FAILED') && (
            <TouchableOpacity
              style={[styles.actionBtn, { marginTop: 4 }]}
              onPress={() => {
                biometricAuth.reset();
                setPhase('DETECTING_FACE');
                setSim(null);
                setMessage('Position your face in the oval');
              }}
            >
              <Text style={styles.actionText}>
                {phase === 'SUCCESS' ? 'Authenticate Again' : 'Retry'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', padding: 24, gap: 16 },
  permTitle:   { color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub:     { color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  gray:        { color: '#94A3B8', marginTop: 12 },
  overlay:     { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    padding:          16,
    paddingTop:       Platform.OS === 'ios' ? 56 : 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  appName:     { color: '#F8FAFC', fontSize: 17, fontWeight: '600' },
  syncBadge:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  syncPending: { backgroundColor: '#F59E0B' },
  syncOk:      { backgroundColor: '#10B981' },
  syncText:    { color: '#fff', fontSize: 12, fontWeight: '600' },
  ovalWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:        { width: 220, height: 280, borderRadius: 110, borderWidth: 3 },
  card: {
    backgroundColor: 'rgba(15,23,42,0.85)',
    margin:           16,
    padding:          20,
    borderRadius:     16,
    alignItems:       'center',
    gap:              8,
  },
  dot:         { width: 10, height: 10, borderRadius: 5, marginBottom: 2 },
  statusText:  { color: '#F8FAFC', fontSize: 16, fontWeight: '500', textAlign: 'center' },
  simText:     { color: '#94A3B8', fontSize: 13 },
  actionBtn:   { backgroundColor: '#3B82F6', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  actionText:  { color: '#fff', fontWeight: '600', fontSize: 14 },
});
