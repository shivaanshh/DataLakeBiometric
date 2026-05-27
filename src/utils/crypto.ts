/**
 * crypto.ts
 *
 * AES-256-GCM encryption for face embeddings stored in SQLite.
 *
 * Key management:
 *   - A per-device 256-bit key is generated on first run
 *   - Stored in Android Keystore / iOS Secure Enclave via react-native-sensitive-info
 *   - Never stored in AsyncStorage, SQLite, or the file system
 *
 * TODO for Claude Code:
 *   - Install: npm install react-native-sensitive-info
 *   - On Android, verify android:usesCleartextTraffic=false in AndroidManifest.xml
 *   - Test key persistence across app reinstalls (behavior differs Android/iOS)
 */

import SInfo from 'react-native-sensitive-info';
import { Platform } from 'react-native';

const KEY_SERVICE  = 'DataLakeBiometric';
const KEY_ALIAS    = 'face_embedding_key';
const IV_LENGTH    = 12;  // 96 bits — recommended for AES-GCM
const TAG_LENGTH   = 16;  // 128-bit authentication tag

// ─── Key Management ────────────────────────────────────────────────────────

async function getOrCreateKey(): Promise<string> {
  try {
    const existing = await SInfo.getItem(KEY_ALIAS, {
      sharedPreferencesName: KEY_SERVICE,
      keychainService:       KEY_SERVICE,
    });
    if (existing) return existing;
  } catch {
    // Key doesn't exist yet
  }

  // Generate 256-bit key as hex string
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const keyHex = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  await SInfo.setItem(KEY_ALIAS, keyHex, {
    sharedPreferencesName: KEY_SERVICE,
    keychainService:       KEY_SERVICE,
    // Android only: store in Keystore
    kSecAttrAccessible: 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly',
  });

  return keyHex;
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(
    keyHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
  );
  return crypto.subtle.importKey(
    'raw', keyBytes.buffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
}

// ─── Encrypt / Decrypt ─────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns a base64 string of format: [IV (12 bytes) | ciphertext | auth tag (16 bytes)]
 */
export async function encryptData(plaintext: string): Promise<string> {
  const keyHex    = await getOrCreateKey();
  const cryptoKey = await importKey(keyHex);

  const iv         = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded    = new TextEncoder().encode(plaintext);

  const cipherBuf  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    encoded
  );

  // Concatenate IV + ciphertext (tag is appended by SubtleCrypto)
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);

  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypts a base64 AES-256-GCM encrypted string.
 * Throws on authentication failure (tampered data).
 */
export async function decryptData(encBase64: string): Promise<string> {
  const keyHex    = await getOrCreateKey();
  const cryptoKey = await importKey(keyHex);

  const combined = new Uint8Array(Buffer.from(encBase64, 'base64'));
  const iv        = combined.slice(0, IV_LENGTH);
  const cipherBuf = combined.slice(IV_LENGTH);

  const plainBuf  = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    cryptoKey,
    cipherBuf
  );

  return new TextDecoder().decode(plainBuf);
}

/** Wipe the encryption key (use on logout or device wipe) */
export async function deleteKey(): Promise<void> {
  await SInfo.deleteItem(KEY_ALIAS, {
    sharedPreferencesName: KEY_SERVICE,
    keychainService:       KEY_SERVICE,
  });
}
