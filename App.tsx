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
  const [inputId,  setInputId]  = useState('');
  const [activeId, setActiveId] = useState('');
  const [lastUser, setLastUser] = useState<{ id: string; name: string } | null>(null);

  if (screen === 'enroll') {
    return (
      <EnrollScreen
        onEnrolled={(id, name) => {
          setLastUser({ id, name });
          setInputId(id);
          setScreen('home');
        }}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        userId={activeId}
        onSuccess={() => setScreen('home')}
        onBack={() => setScreen('home')}
      />
    );
  }

  const canAuth = inputId.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>🔐</Text>
          <Text style={styles.title}>DataLake Biometric</Text>
          <Text style={styles.subtitle}>Offline Face Authentication</Text>
        </View>

        {/* User ID input */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>Employee ID</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your employee ID (e.g. EMP001)"
            placeholderTextColor="#475569"
            value={inputId}
            onChangeText={setInputId}
            autoCapitalize="characters"
            returnKeyType="done"
          />
          {lastUser && (
            <Text style={styles.lastUser}>
              Last enrolled: {lastUser.name} ({lastUser.id})
            </Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.btn, styles.primary, !canAuth && styles.disabled]}
            disabled={!canAuth}
            activeOpacity={0.85}
            onPress={() => {
              setActiveId(inputId.trim());
              setScreen('auth');
            }}
          >
            <Text style={styles.primaryText}>Authenticate</Text>
            <Text style={styles.btnSub}>Verify your identity via face scan</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.outline]}
            activeOpacity={0.85}
            onPress={() => setScreen('enroll')}
          >
            <Text style={styles.outlineText}>Enroll New Face</Text>
            <Text style={[styles.btnSub, { color: '#60A5FA' }]}>Register a new user</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>Powered by BlazeFace · FaceMesh · MobileFaceNet</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#0F172A' },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 28 },
  header:    { alignItems: 'center', gap: 8 },
  logo:      { fontSize: 56, marginBottom: 4 },
  title: {
    fontSize:     28,
    fontWeight:   '700',
    color:        '#F8FAFC',
    letterSpacing: 0.3,
  },
  subtitle:   { fontSize: 15, color: '#94A3B8' },
  inputCard:  { gap: 8 },
  inputLabel: { color: '#94A3B8', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#1E293B',
    borderRadius:     12,
    padding:          14,
    color:            '#F8FAFC',
    fontSize:         16,
    borderWidth:      1,
    borderColor:      '#334155',
  },
  lastUser:   { color: '#475569', fontSize: 12, marginTop: 2 },
  buttons:    { gap: 14 },
  btn: {
    borderRadius:      14,
    paddingVertical:   18,
    paddingHorizontal: 24,
    alignItems:        'center',
    gap:                4,
  },
  primary:      { backgroundColor: '#3B82F6' },
  outline:      { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#3B82F6' },
  disabled:     { opacity: 0.4 },
  primaryText:  { color: '#fff',     fontSize: 17, fontWeight: '700' },
  outlineText:  { color: '#60A5FA',  fontSize: 17, fontWeight: '700' },
  btnSub:       { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  footer:       { color: '#334155', fontSize: 11, textAlign: 'center' },
});
