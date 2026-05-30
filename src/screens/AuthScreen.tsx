import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import { useCamera } from '../plugins/useCamera';
import { biometricAuth, AuthPhase, AuthEvent } from '../modules/BiometricAuth';
import { syncManager, SyncResult } from '../storage/syncManager';
import { useDetectAndMesh, DetectResult } from '../plugins/useDetectAndMesh';

interface Props {
  userId:    string;
  onSuccess?: () => void;
  onBack?:    () => void;
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

const CHALLENGE_ICON: Record<string, string> = {
  BLINK:      '👁',
  SMILE:      '😊',
  TURN_LEFT:  '←',
  TURN_RIGHT: '→',
};

export default function AuthScreen({ userId, onSuccess, onBack }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCamera(hasPermission);

  const [phase,   setPhase]   = useState<AuthPhase>('IDLE');
  const [message, setMessage] = useState('Initializing...');
  const [sim,     setSim]     = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [camActive, setCamActive] = useState(false);

  const phaseRef = useRef<AuthPhase>('IDLE');

  // Samsung black-preview fix
  useEffect(() => {
    const t = setTimeout(() => setCamActive(true), 400);
    return () => clearTimeout(t);
  }, []);

  // Subscribe to auth events
  useEffect(() => {
    biometricAuth.reset();
    const off = biometricAuth.on((e: AuthEvent) => {
      phaseRef.current = e.phase;
      setPhase(e.phase);
      setMessage(e.message);
      if (e.similarity !== undefined) setSim(e.similarity);
      if (e.phase === 'SUCCESS') onSuccess?.();
    });

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
  }, [onSuccess]);

  // Frame processor callback
  const handleDetect = useCallback((r: DetectResult | null) => {
    if (phaseRef.current === 'SUCCESS' || phaseRef.current === 'FAILED') return;

    biometricAuth.processAuthFrame({
      userId,
      landmarks: r?.landmarks ?? null,
      embedding: r?.embedding ?? null,
    });
  }, [userId]);

  const { frameProcessor, isLoading } = useDetectAndMesh(handleDetect);

  const isRunning  = !['SUCCESS', 'FAILED'].includes(phase);
  const color      = PHASE_COLOR[phase];
  const challenge  = (phase === 'LIVENESS' && message.includes('Blink'))  ? 'BLINK'
                   : (phase === 'LIVENESS' && message.includes('smile'))   ? 'SMILE'
                   : (phase === 'LIVENESS' && message.includes('left'))    ? 'TURN_LEFT'
                   : (phase === 'LIVENESS' && message.includes('right'))   ? 'TURN_RIGHT'
                   : null;

  // ── Permission gate ────────────────────────────────────────────────────────
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
        <Text style={styles.gray}>Initializing camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={camActive && isRunning}
        video
        frameProcessor={camActive && isRunning && !isLoading ? frameProcessor : undefined}
        fps={15}
        pixelFormat="rgb"
      />

      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={{ gap: 2 }}>
            {onBack && (
              <TouchableOpacity onPress={onBack}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.appName}>DataLake Biometric</Text>
            <Text style={styles.userLabel}>ID: {userId}</Text>
          </View>
          <TouchableOpacity
            onPress={async () => { setSyncing(true); await syncManager.forceSyncNow(); }}
            disabled={syncing}
          >
            <View style={[styles.syncBadge, pending > 0 ? styles.syncPending : styles.syncOk]}>
              {syncing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.syncText}>{pending > 0 ? `↑ ${pending}` : '✓ Synced'}</Text>
              }
            </View>
          </TouchableOpacity>
        </View>

        {/* Oval guide */}
        <View style={styles.ovalWrap}>
          <View style={[styles.oval, { borderColor: color }]} />
          {challenge && (
            <Text style={styles.challengeIcon}>{CHALLENGE_ICON[challenge]}</Text>
          )}
        </View>

        {/* Status card */}
        <View style={styles.card}>
          {isLoading ? (
            <>
              <ActivityIndicator size="small" color="#94A3B8" />
              <Text style={styles.statusText}>Loading AI models...</Text>
            </>
          ) : (
            <>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.statusText}>{message}</Text>
              {sim !== null && (
                <Text style={styles.simText}>
                  Confidence: {(sim * 100).toFixed(1)}%
                </Text>
              )}
              {(phase === 'SUCCESS' || phase === 'FAILED') && (
                <TouchableOpacity
                  style={[styles.actionBtn, { marginTop: 4 }]}
                  onPress={() => {
                    setSim(null);
                    biometricAuth.reset();
                  }}
                >
                  <Text style={styles.actionText}>
                    {phase === 'SUCCESS' ? 'Authenticate Again' : 'Try Again'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
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
    alignItems:      'flex-end',
    padding:          16,
    paddingTop:       Platform.OS === 'ios' ? 56 : 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backText:    { color: '#60A5FA', fontSize: 14, marginBottom: 4 },
  appName:     { color: '#F8FAFC', fontSize: 16, fontWeight: '700' },
  userLabel:   { color: '#94A3B8', fontSize: 12 },
  syncBadge:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  syncPending: { backgroundColor: '#F59E0B' },
  syncOk:      { backgroundColor: '#10B981' },
  syncText:    { color: '#fff', fontSize: 12, fontWeight: '600' },
  ovalWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:        { width: 220, height: 280, borderRadius: 110, borderWidth: 3 },
  challengeIcon: {
    position:  'absolute',
    bottom:     -36,
    fontSize:   40,
  },
  card: {
    backgroundColor: 'rgba(15,23,42,0.88)',
    margin:           16,
    padding:          20,
    borderRadius:     16,
    alignItems:       'center',
    gap:               8,
  },
  dot:        { width: 10, height: 10, borderRadius: 5, marginBottom: 2 },
  statusText: { color: '#F8FAFC', fontSize: 16, fontWeight: '500', textAlign: 'center' },
  simText:    { color: '#94A3B8', fontSize: 13 },
  actionBtn:  { backgroundColor: '#3B82F6', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
