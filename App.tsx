import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import EnrollScreen from './src/screens/EnrollScreen';
import AuthScreen   from './src/screens/AuthScreen';

type Screen = 'home' | 'enroll' | 'auth';

export default function App() {
  const [screen,   setScreen]   = useState<Screen>('home');
  const [empId,    setEmpId]    = useState('');
  const [authId,   setAuthId]   = useState('');
  const [lastName, setLastName] = useState('');

  // ── Enroll screen ──────────────────────────────────────────────────────────
  if (screen === 'enroll') {
    return (
      <EnrollScreen
        onEnrolled={(id, name) => {
          setLastName(name);
          setEmpId(id);
          setScreen('home');
        }}
        onBack={() => setScreen('home')}
      />
    );
  }

  // ── Auth screen ────────────────────────────────────────────────────────────
  if (screen === 'auth') {
    return (
      <AuthScreen
        userId={authId}
        onSuccess={() => setScreen('home')}
        onBack={() => setScreen('home')}
      />
    );
  }

  // ── Home screen ────────────────────────────────────────────────────────────
  const canAuth = empId.trim().length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      <KeyboardAvoidingView
        style={s.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Hero */}
        <View style={s.hero}>
          <Text style={s.logoEmoji}>🔐</Text>
          <Text style={s.appName}>DataLake Biometric</Text>
          <Text style={s.tagline}>Offline Face Authentication</Text>
        </View>

        {/* Employee ID input */}
        <View style={s.inputSection}>
          <Text style={s.inputLabel}>EMPLOYEE ID</Text>
          <TextInput
            style={s.input}
            placeholder="Enter your employee ID  (e.g. EMP001)"
            placeholderTextColor="#475569"
            value={empId}
            onChangeText={setEmpId}
            autoCapitalize="characters"
            returnKeyType="done"
          />
          {!!lastName && (
            <Text style={s.hint}>Last enrolled: {lastName} · {empId}</Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={s.buttons}>
          {/* Authenticate */}
          <TouchableOpacity
            style={[s.btn, s.btnPrimary, !canAuth && s.btnDisabled]}
            disabled={!canAuth}
            activeOpacity={0.85}
            onPress={() => {
              setAuthId(empId.trim());
              setScreen('auth');
            }}
          >
            <Text style={s.btnPrimaryText}>Authenticate</Text>
            <Text style={s.btnSub}>Verify identity via face scan</Text>
          </TouchableOpacity>

          {/* Enroll */}
          <TouchableOpacity
            style={[s.btn, s.btnOutline]}
            activeOpacity={0.85}
            onPress={() => setScreen('enroll')}
          >
            <Text style={s.btnOutlineText}>Enroll New Face</Text>
            <Text style={[s.btnSub, { color: '#60A5FA' }]}>Register a new user</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          BlazeFace · FaceMesh · MobileFaceNet · Fully Offline
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F172A' },
  kav:  { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 28 },

  hero:      { alignItems: 'center', gap: 8 },
  logoEmoji: { fontSize: 60, marginBottom: 4 },
  appName: {
    color:         '#F8FAFC',
    fontSize:       28,
    fontWeight:    '800',
    letterSpacing:  0.3,
  },
  tagline: { color: '#94A3B8', fontSize: 15 },

  inputSection: { gap: 8 },
  inputLabel:   { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  input: {
    backgroundColor: '#1E293B',
    borderRadius:     12,
    padding:          15,
    color:            '#F8FAFC',
    fontSize:         16,
    borderWidth:      1,
    borderColor:      '#334155',
  },
  hint: { color: '#475569', fontSize: 12 },

  buttons: { gap: 14 },
  btn: {
    borderRadius:      14,
    paddingVertical:   18,
    paddingHorizontal: 24,
    alignItems:        'center',
    gap:                4,
  },
  btnPrimary:     { backgroundColor: '#3B82F6' },
  btnOutline:     { borderWidth: 1.5, borderColor: '#3B82F6' },
  btnDisabled:    { opacity: 0.35 },
  btnPrimaryText: { color: '#fff',     fontSize: 17, fontWeight: '700' },
  btnOutlineText: { color: '#60A5FA',  fontSize: 17, fontWeight: '700' },
  btnSub:         { color: 'rgba(255,255,255,0.50)', fontSize: 12 },

  footer: { color: '#1E293B', fontSize: 11, textAlign: 'center' },
});
