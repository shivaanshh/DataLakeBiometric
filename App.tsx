import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar,
} from 'react-native';
import AuthScreen   from './src/screens/AuthScreen';
import EnrollScreen from './src/screens/EnrollScreen';

type Screen = 'home' | 'enroll' | 'auth';

const DEMO_USER_ID = 'demo_user_001';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');

  if (screen === 'enroll') {
    return <EnrollScreen onEnrolled={() => setScreen('home')} />;
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        userId={DEMO_USER_ID}
        onSuccess={() => setScreen('home')}
        onFailed={() => setScreen('home')}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      <View style={styles.header}>
        <Text style={styles.logo}>🔐</Text>
        <Text style={styles.title}>DataLake Biometric</Text>
        <Text style={styles.subtitle}>Offline Face Authentication</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, styles.primary]}
          onPress={() => setScreen('auth')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryText}>Authenticate</Text>
          <Text style={styles.btnSub}>Verify your identity</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.secondary]}
          onPress={() => setScreen('enroll')}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryText}>Enroll Face</Text>
          <Text style={[styles.btnSub, { color: '#60A5FA' }]}>Register a new user</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>User: {DEMO_USER_ID} · Offline Mode</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0F172A',
    justifyContent:  'center',
    alignItems:      'center',
    padding:          24,
    gap:              24,
  },
  header: { alignItems: 'center', gap: 8 },
  logo:   { fontSize: 56, marginBottom: 4 },
  title: {
    fontSize:    28,
    fontWeight:  '700',
    color:       '#F8FAFC',
    letterSpacing: 0.3,
  },
  subtitle: { fontSize: 15, color: '#94A3B8' },
  buttons: { width: '100%', gap: 14 },
  btn: {
    borderRadius:   14,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems:     'center',
    gap:             4,
  },
  primary:      { backgroundColor: '#3B82F6' },
  secondary:    { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#3B82F6' },
  primaryText:  { color: '#fff',     fontSize: 17, fontWeight: '700' },
  secondaryText:{ color: '#60A5FA',  fontSize: 17, fontWeight: '700' },
  btnSub:       { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  footer:       { color: '#475569', fontSize: 12, position: 'absolute', bottom: 24 },
});
