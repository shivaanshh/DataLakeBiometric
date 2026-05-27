/**
 * App.tsx — root component for DataLake Biometric
 *
 * Simple two-screen flow:
 *   Enroll screen  → lets a user register their face
 *   Auth screen    → authenticates via BlazeFace + FaceMesh + MobileFaceNet
 *
 * For the hackathon demo, the active userId is hardcoded so you can test
 * immediately on a physical device without a login system.
 * Replace with your actual user management / Datalake 3.0 session token.
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import AuthScreen   from './src/screens/AuthScreen';
import EnrollScreen from './src/screens/EnrollScreen';

type Screen = 'home' | 'enroll' | 'auth';

// Replace with the real signed-in user ID from Datalake 3.0 session
const DEMO_USER_ID   = 'demo_user_001';
const DEMO_USER_NAME = 'Demo User';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');

  if (screen === 'enroll') {
    return (
      <EnrollScreen
        onEnrolled={() => setScreen('home')}
      />
    );
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        userId={DEMO_USER_ID}
        onSuccess={() => setScreen('home')}
        onFailed={()  => setScreen('home')}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>DataLake Biometric</Text>
      <Text style={styles.subtitle}>Offline Face Authentication</Text>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => setScreen('auth')}
        >
          <Text style={styles.btnText}>Authenticate</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => setScreen('enroll')}
        >
          <Text style={styles.btnTextSecondary}>Enroll Face</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>User: {DEMO_USER_ID}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#94A3B8',
    marginBottom: 24,
  },
  buttons: {
    width: '80%',
    gap: 12,
  },
  btn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#3B82F6',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  btnTextSecondary: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    color: '#475569',
    marginTop: 8,
  },
});
