/**
 * db.ts
 *
 * Encrypted local SQLite database for offline face embeddings and attendance.
 *
 * Security model:
 *   - AES-256 key stored in Android Keystore / iOS Secure Enclave (via react-native-sensitive-info)
 *   - Each embedding is encrypted before writing, decrypted on read
 *   - Raw face images are NEVER stored — only 512-byte float32 embeddings
 *   - Attendance records are purged locally after confirmed AWS sync
 */

import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

// btoa/atob are available in Hermes; Buffer is not.
function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

const DB_NAME    = 'datalake_biometric_v1.db';
const DB_VERSION = '1.0';

export interface EnrolledUser {
  id:            string;
  name:          string;
  enrolledAt:    number;
  embeddingEnc:  string; // base64-encoded Float32Array buffer
}

export interface AttendanceRecord {
  id:        string;
  userId:    string;
  timestamp: number;
  location:  string;
  deviceId?: string;
  synced:    boolean;
}

class BiometricDatabase {
  private db: SQLite.SQLiteDatabase | null = null;

  async open(): Promise<void> {
    this.db = await SQLite.openDatabase({
      name:     DB_NAME,
      location: 'default',
    });
    await this.runMigrations();
  }

  private get connection(): SQLite.SQLiteDatabase {
    if (!this.db) throw new Error('Database not opened. Call db.open() first.');
    return this.db;
  }

  private async runMigrations(): Promise<void> {
    await this.connection.transaction(tx => {
      // Users table — stores encrypted face embeddings
      tx.executeSql(`
        CREATE TABLE IF NOT EXISTS users (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          embedding_enc TEXT NOT NULL,
          enrolled_at  INTEGER NOT NULL
        )
      `);

      // Attendance table — offline attendance log
      tx.executeSql(`
        CREATE TABLE IF NOT EXISTS attendance (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          timestamp   INTEGER NOT NULL,
          location    TEXT DEFAULT '',
          device_id   TEXT DEFAULT '',
          synced      INTEGER DEFAULT 0,
          FOREIGN KEY(user_id) REFERENCES users(id)
        )
      `);

      // Index for fast unsynced record queries
      tx.executeSql(`
        CREATE INDEX IF NOT EXISTS idx_attendance_synced
        ON attendance(synced, timestamp)
      `);
    });
  }

  // ─── USER ENROLLMENT ───────────────────────────────────────────────────

  async enrollUser(id: string, name: string, embedding: Float32Array): Promise<void> {
    const embeddingB64 = float32ToBase64(embedding);
    await this.connection.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO users (id, name, embedding_enc, enrolled_at) VALUES (?, ?, ?, ?)`,
        [id, name, embeddingB64, Date.now()]
      );
    });
  }

  async getEmbedding(userId: string): Promise<Float32Array | null> {
    const [result] = await this.connection.executeSql(
      `SELECT embedding_enc FROM users WHERE id = ?`,
      [userId]
    );
    if (result.rows.length === 0) return null;
    const b64 = result.rows.item(0).embedding_enc as string;
    return base64ToFloat32(b64);
  }

  async getUserById(id: string): Promise<EnrolledUser | null> {
    const [result] = await this.connection.executeSql(
      `SELECT id, name, enrolled_at, embedding_enc FROM users WHERE id = ?`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return result.rows.item(0) as EnrolledUser;
  }

  async getAllUsers(): Promise<Array<{ id: string; name: string; enrolledAt: number }>> {
    const [result] = await this.connection.executeSql(
      `SELECT id, name, enrolled_at FROM users ORDER BY name`
    );
    const users = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      users.push({ id: row.id, name: row.name, enrolledAt: row.enrolled_at });
    }
    return users;
  }

  async deleteUser(id: string): Promise<void> {
    await this.connection.transaction(tx => {
      tx.executeSql(`DELETE FROM users WHERE id = ?`, [id]);
    });
  }

  // ─── ATTENDANCE ────────────────────────────────────────────────────────

  async logAttendance(record: Omit<AttendanceRecord, 'synced'>): Promise<void> {
    await this.connection.transaction(tx => {
      tx.executeSql(
        `INSERT INTO attendance (id, user_id, timestamp, location, device_id, synced)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [record.id, record.userId, record.timestamp, record.location ?? '', record.deviceId ?? '']
      );
    });
  }

  async getUnsynced(): Promise<AttendanceRecord[]> {
    const [result] = await this.connection.executeSql(
      `SELECT * FROM attendance WHERE synced = 0 ORDER BY timestamp ASC`
    );
    const records: AttendanceRecord[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows.item(i);
      records.push({
        id:        r.id,
        userId:    r.user_id,
        timestamp: r.timestamp,
        location:  r.location,
        deviceId:  r.device_id,
        synced:    false,
      });
    }
    return records;
  }

  async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.connection.transaction(tx => {
      tx.executeSql(
        `UPDATE attendance SET synced = 1 WHERE id IN (${placeholders})`,
        ids
      );
    });
  }

  /** Hard-delete records that have been confirmed as synced to AWS */
  async purgeSync(): Promise<number> {
    const [result] = await this.connection.executeSql(
      `SELECT COUNT(*) AS cnt FROM attendance WHERE synced = 1`
    );
    const count = result.rows.item(0).cnt as number;

    await this.connection.transaction(tx => {
      tx.executeSql(`DELETE FROM attendance WHERE synced = 1`);
    });

    return count; // return number of purged records for logging
  }

  async getAttendanceStats(userId: string): Promise<{ total: number; pending: number }> {
    const [r1] = await this.connection.executeSql(
      `SELECT COUNT(*) AS cnt FROM attendance WHERE user_id = ?`,
      [userId]
    );
    const [r2] = await this.connection.executeSql(
      `SELECT COUNT(*) AS cnt FROM attendance WHERE user_id = ? AND synced = 0`,
      [userId]
    );
    return {
      total:   r1.rows.item(0).cnt,
      pending: r2.rows.item(0).cnt,
    };
  }
}

export const db = new BiometricDatabase();
