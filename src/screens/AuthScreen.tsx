import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import { useCamera }                   from '../plugins/useCamera';
import { useDetectAndMesh, DetectResult } from '../plugins/useDetectAndMesh';
import { biometricAuth, Phase, AuthEvent } from '../modules/BiometricAuth';
import { syncManager, SyncResult }     from '../storage/syncManager';

// ── Types & constants ─────────────────────────────────────────────────────────
interface Props {
  userId:    string;
  onSuccess?: () => void;
  onBack?:    () => void;
}

const PHASE_COLOR: Record<Phase, string> = {
  IDLE:           '#6B7280',
  DETECTING_FACE: '#3B82F6',
  LIVENESS:       '#F59E0B',
  RECOGNIZING:    '#8B5CF6',
  SUCCESS:        '#10B981',
  FAILED:         '#EF4444',
  ENROLLING:      '#3B82F6',
  ENROLLED:       '#10B981',
};

const CHALLENGE_EMOJI: Record<string, string> = {
  BLINK:      '👁',
  SMILE:      '😊',
  TURN_LEFT:  '←',
  TURN_RIGHT: '→',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function AuthScreen({ userId, onSuccess, onBack }: Props) {
  // Camera hooks — always called unconditionally
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCamera(hasPermission);

  // State
  const [phase,    setPhase]    = useState<Phase>('IDLE');
  const [message,  setMessage]  = useState('Initializing...');
  const [sim,      setSim]      = useState<number | null>(null);
  const [pending,  setPending]  = useState(0);
  const [syncing,  setSyncing]  = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);

  const phaseRef = useRef<Phase>('IDLE');

  // Samsung Galaxy black-preview fix
  useEffect(() => {
    const t = setTimeout(() => setCamReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  // Subscribe to BiometricAuth events & sync
  useEffect(() => {
    biometricAuth.reset();

    const off = biometricAuth.on((e: AuthEvent) => {
      phaseRef.current = e.phase;
      setPhase(e.phase);
      setMessage(e.message);
      setChallenge(e.challenge ?? null);
      if (e.similarity !== undefined) setSim(e.similarity);
      if (e.phase === 'SUCCESS') onSuccess?.();
    });

    syncManager.startListening(async (r: SyncResult) => {
      setSyncing(false);
      setPending(await syncManager.getPendingCount());
      if (r.synced > 0) Alert.alert('Sync complete', `${r.synced} attendance records uploaded.`);
    });
    syncManager.getPendingCount().then(setPending);

    return () => {
      off();
      syncManager.stopListening();
    };
  }, [onSuccess]);

  // ── Frame processor callback ───────────────────────────────────────────────
  const onDetect = useCallback((r: DetectResult | null) => {
    if (phaseRef.current === 'SUCCESS' || phaseRef.current === 'FAILED') return;

    biometricAuth.processAuthFrame({
      userId,
      landmarks: r?.landmarks ?? null,
      embedding: r?.embedding ?? null,
    });
  }, [userId]);

  const { frameProcessor, isLoading } = useDetectAndMesh(onDetect);

  const isActive = !['SUCCESS', 'FAILED'].includes(phase);
  const color    = PHASE_COLOR[phase];

  // ── Permission gate ────────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={s.center}>
        <Text style={s.permTitle}>Camera Access Required</Text>
        <Text style={s.permSub}>Camera permission is needed for face authentication.</Text>
        <TouchableOpacity style={s.primaryBtn} onPress={requestPermission}>
          <Text style={s.primaryBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={s.grayText}>Initializing camera...</Text>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      {/* Camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={camReady && isActive}
        video
        frameProcessor={camReady && isActive && !isLoading ? frameProcessor : undefined}
        fps={15}
        pixelFormat="rgb"
      />

      {/* Overlay */}
      <View style={s.overlay}>

        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <View style={s.topBar}>
          <View>
            {onBack && (
              <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.backText}>← Back</Text>
              </TouchableOpacity>
            )}
            <Text style={s.appTitle}>DataLake Biometric</Text>
            <Text style={s.userLabel}>ID: {userId}</Text>
          </View>

          {/* Sync button */}
          <TouchableOpacity
            onPress={async () => { setSyncing(true); await syncManager.forceSyncNow(); }}
            disabled={syncing}
          >
            <View style={[s.syncBadge, pending > 0 ? s.syncPending : s.syncOk]}>
              {syncing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.syncText}>{pending > 0 ? `↑ ${pending}` : '✓ Synced'}</Text>
              }
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Oval guide ──────────────────────────────────────────────── */}
        <View style={s.ovalWrapper}>
          <View style={[s.oval, { borderColor: color }]} />
          {challenge && phase === 'LIVENESS' && (
            <Text style={s.challengeEmoji}>{CHALLENGE_EMOJI[challenge] ?? '?'}</Text>
          )}
        </View>

        {/* ── Status card ─────────────────────────────────────────────── */}
        <View style={s.card}>
          {isLoading ? (
            <>
              <ActivityIndicator size="small" color="#94A3B8" />
              <Text style={s.cardMessage}>Loading AI models...</Text>
            </>
          ) : (
            <>
              <View style={[s.phaseDot, { backgroundColor: color }]} />
              <Text style={s.cardMessage}>{message}</Text>
              {sim !== null && (
                <Text style={s.simText}>Confidence: {(sim * 100).toFixed(1)}%</Text>
              )}
              {(phase === 'SUCCESS' || phase === 'FAILED') && (
                <TouchableOpacity
                  style={[s.retryBtn, { backgroundColor: phase === 'SUCCESS' ? '#10B981' : '#3B82F6' }]}
                  onPress={() => {
                    setSim(null);
                    setChallenge(null);
                    biometricAuth.reset();
                  }}
                >
                  <Text style={s.retryBtnText}>
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

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', padding: 28, gap: 16 },
  permTitle: { color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub:   { color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  grayText:  { color: '#94A3B8', marginTop: 12, fontSize: 14 },
  primaryBtn:     { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  overlay:    { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'flex-end',
    padding:          16,
    paddingTop:       Platform.OS === 'ios' ? 56 : 18,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },
  backText:  { color: '#60A5FA', fontSize: 14, marginBottom: 6 },
  appTitle:  { color: '#F8FAFC', fontSize: 16, fontWeight: '700' },
  userLabel: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  syncBadge:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  syncPending: { backgroundColor: '#F59E0B' },
  syncOk:      { backgroundColor: '#10B981' },
  syncText:    { color: '#fff', fontSize: 12, fontWeight: '700' },

  ovalWrapper:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  oval:           { width: 220, height: 280, borderRadius: 110, borderWidth: 3 },
  challengeEmoji: { position: 'absolute', bottom: -44, fontSize: 42 },

  card: {
    backgroundColor: 'rgba(15,23,42,0.90)',
    margin:           16,
    padding:          22,
    borderRadius:     20,
    alignItems:       'center',
    gap:               8,
  },
  phaseDot:    { width: 10, height: 10, borderRadius: 5, marginBottom: 2 },
  cardMessage: { color: '#F8FAFC', fontSize: 16, fontWeight: '500', textAlign: 'center', lineHeight: 24 },
  simText:     { color: '#94A3B8', fontSize: 13 },
  retryBtn:    { borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 4 },
  retryBtnText:{ color: '#fff', fontWeight: '700', fontSize: 14 },
});
