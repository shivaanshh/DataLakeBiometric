import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Camera, useCameraPermission, useCameraDevice } from 'react-native-vision-camera';
import { useDetectAndMesh, DetectResult } from '../plugins/useDetectAndMesh';
import { biometricAuth, AuthState, Phase } from '../modules/BiometricAuth';
import { startListening, stopListening } from '../storage/syncManager';

const CHALLENGE_EMOJI: Record<string, string> = {
  'Blink your eyes': '👁',
  'Smile': '😊',
  'Turn head left': '←',
  'Turn head right': '→',
};

interface Props {
  userId: string;
  onSuccess: (userName: string) => void;
  onCancel: () => void;
}

export default function AuthScreen({ userId, onSuccess, onCancel }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const device = frontDevice ?? backDevice;

  const [authState, setAuthState] = useState<AuthState>(biometricAuth.getState());
  const [camReady, setCamReady] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  const phaseRef = useRef<Phase>(authState.phase);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    const timer = setTimeout(() => setCamReady(true), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    biometricAuth.reset();

    const handleState = (state: AuthState) => {
      phaseRef.current = state.phase;
      setAuthState({ ...state });
      if (state.phase === 'SUCCESS' && state.userName) {
        onSuccess(state.userName);
      }
    };

    biometricAuth.on('stateChange', handleState);
    return () => { biometricAuth.off('stateChange', handleState); };
  }, [onSuccess]);

  useEffect(() => {
    startListening(setPendingSync);
    return () => stopListening();
  }, []);

  const onDetect = useCallback((result: DetectResult | null) => {
    const phase = phaseRef.current;
    if (phase === 'SUCCESS' || phase === 'FAILED' || phase === 'IDLE') return;

    biometricAuth.processAuthFrame({
      userId,
      landmarks: result?.landmarks ?? [],
      embedding: result?.embedding ?? null,
    });
  }, [userId]);

  const { frameProcessor, isLoading } = useDetectAndMesh(onDetect);

  const isTerminal = authState.phase === 'SUCCESS' || authState.phase === 'FAILED';

  const ovalColor =
    authState.phase === 'SUCCESS' ? '#4CAF50' :
    authState.phase === 'FAILED'  ? '#f44336' :
    authState.phase === 'LIVENESS' ? '#FF9800' : '#2196F3';

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Authenticate</Text>
        {pendingSync > 0 ? (
          <View style={s.syncBadge}>
            <Text style={s.syncText}>{pendingSync} pending</Text>
          </View>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      <View style={s.cameraWrap}>
        {device && camReady && !isLoading && !isTerminal ? (
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
            {isTerminal ? null : (
              <>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={s.loadingText}>
                  {isLoading ? 'Loading models...' : 'Starting camera...'}
                </Text>
              </>
            )}
          </View>
        )}

        <View style={[s.ovalBorder, { borderColor: ovalColor }]} />

        {authState.phase === 'LIVENESS' && authState.challenge && (
          <View style={s.challengeOverlay}>
            <Text style={s.challengeEmoji}>
              {CHALLENGE_EMOJI[authState.challenge] ?? '?'}
            </Text>
            <Text style={s.challengeText}>{authState.challenge}</Text>
            {authState.progress && (
              <Text style={s.progressText}>
                {authState.progress.done}/{authState.progress.total}
              </Text>
            )}
          </View>
        )}

        {authState.phase === 'SUCCESS' && (
          <View style={s.resultOverlay}>
            <Text style={s.resultIcon}>✓</Text>
            <Text style={s.resultText}>Welcome, {authState.userName}!</Text>
          </View>
        )}

        {authState.phase === 'FAILED' && (
          <View style={s.resultOverlay}>
            <Text style={[s.resultIcon, { color: '#f44336' }]}>✗</Text>
            <Text style={[s.resultText, { color: '#f44336' }]}>{authState.message}</Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        {!isTerminal ? (
          <Text style={s.statusText}>{authState.message}</Text>
        ) : (
          <TouchableOpacity
            style={[s.btn, authState.phase === 'FAILED' && s.btnRetry]}
            onPress={() => {
              biometricAuth.reset();
              setAuthState(biometricAuth.getState());
              phaseRef.current = 'IDLE';
            }}
          >
            <Text style={s.btnText}>
              {authState.phase === 'SUCCESS' ? 'Done' : 'Try Again'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  cancelText: { color: '#2196F3', fontSize: 16 },
  syncBadge: {
    backgroundColor: '#FF9800', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  syncText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  cameraWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
  loadingOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 14 },
  ovalBorder: {
    position: 'absolute', top: '10%', left: '10%', right: '10%', bottom: '10%',
    borderRadius: 200, borderWidth: 3,
  },
  challengeOverlay: {
    position: 'absolute', bottom: 40, alignSelf: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 16, padding: 16, minWidth: 160,
  },
  challengeEmoji: { fontSize: 48, marginBottom: 8 },
  challengeText: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  progressText: { color: '#aaa', fontSize: 14, marginTop: 4 },
  resultOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  resultIcon: { fontSize: 80, color: '#4CAF50', marginBottom: 16 },
  resultText: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', paddingHorizontal: 24 },
  footer: { padding: 24, alignItems: 'center', minHeight: 90 },
  statusText: { color: '#ccc', fontSize: 16, textAlign: 'center' },
  btn: { backgroundColor: '#4CAF50', borderRadius: 12, paddingHorizontal: 40, paddingVertical: 14 },
  btnRetry: { backgroundColor: '#f44336' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
