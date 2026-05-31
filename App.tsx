import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import EnrollScreen from './src/screens/EnrollScreen';
import AuthScreen from './src/screens/AuthScreen';

type Screen = 'home' | 'enroll' | 'auth' | 'success';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [empId, setEmpId] = useState('');
  const [successName, setSuccessName] = useState('');

  if (screen === 'enroll') {
    return (
      <EnrollScreen
        userId={empId.trim()}
        userName={empId.trim()}
        onDone={() => setScreen('home')}
        onCancel={() => setScreen('home')}
      />
    );
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        userId={empId.trim()}
        onSuccess={(name) => { setSuccessName(name); setScreen('success'); }}
        onCancel={() => setScreen('home')}
      />
    );
  }

  if (screen === 'success') {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.successIcon}>✓</Text>
        <Text style={s.successTitle}>Access Granted</Text>
        <Text style={s.successSub}>Welcome, {successName}!</Text>
        <Text style={s.successSub}>Attendance logged.</Text>
        <TouchableOpacity style={s.primaryBtn} onPress={() => { setScreen('home'); setEmpId(''); }}>
          <Text style={s.primaryBtnText}>Back to Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const canProceed = empId.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={s.home}>
        <View style={s.logoWrap}>
          <Text style={s.logo}>DataLake</Text>
          <Text style={s.logoSub}>Biometric Access</Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Employee ID</Text>
          <TextInput
            style={s.input}
            value={empId}
            onChangeText={setEmpId}
            placeholder="Enter your employee ID"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />

          <TouchableOpacity
            style={[s.primaryBtn, !canProceed && s.disabled]}
            disabled={!canProceed}
            onPress={() => setScreen('auth')}
          >
            <Text style={s.primaryBtnText}>Authenticate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.secondaryBtn, !canProceed && s.disabled]}
            disabled={!canProceed}
            onPress={() => setScreen('enroll')}
          >
            <Text style={s.secondaryBtnText}>Enroll New Face</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>Offline biometric · Hackathon 7.0</Text>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  home: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logoWrap: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 36, fontWeight: '800', color: '#4CAF50', letterSpacing: 1 },
  logoSub: { fontSize: 14, color: '#888', marginTop: 4, letterSpacing: 2 },
  card: {
    width: '100%', backgroundColor: '#1a1a1a', borderRadius: 20,
    padding: 24, gap: 16,
  },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  input: {
    backgroundColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#333',
  },
  primaryBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, paddingVertical: 16, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1.5, borderColor: '#4CAF50', borderRadius: 12, paddingVertical: 16, alignItems: 'center',
  },
  secondaryBtnText: { color: '#4CAF50', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.35 },
  footer: { position: 'absolute', bottom: 24, color: '#444', fontSize: 12 },
  successIcon: { fontSize: 80, color: '#4CAF50', marginBottom: 16 },
  successTitle: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  successSub: { color: '#aaa', fontSize: 16, marginBottom: 4, textAlign: 'center' },
});
