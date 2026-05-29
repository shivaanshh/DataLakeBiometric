import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

const DB_NAME = 'biometric_v2.db';

export interface EnrolledUser {
  id:          string;
  name:        string;
  enrolledAt:  number;
  embedding:   string; // base64 Float32Array
}

export interface AttendanceRecord {
  id:        string;
  userId:    string;
  timestamp: number;
  location:  string;
  synced:    boolean;
}

// btoa / atob are available in Hermes; Buffer is NOT.
function float32ToB64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToFloat32(b64: string): Float32Array {
  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

class BiometricDatabase {
  private db:          SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void>         | null = null;

  // Auto-opens on first call — no explicit open() needed.
  private async ready(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return this.db;
    if (!this.initPromise) this.initPromise = this.init();
    await this.initPromise;
    return this.db!;
  }

  private async init(): Promise<void> {
    this.db = await SQLite.openDatabase({ name: DB_NAME, location: 'default' });
    await this.db.transaction(tx => {
      tx.executeSql(`
        CREATE TABLE IF NOT EXISTS users (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          embedding   TEXT NOT NULL,
          enrolled_at INTEGER NOT NULL
        )
      `);
      tx.executeSql(`
        CREATE TABLE IF NOT EXISTS attendance (
          id        TEXT PRIMARY KEY,
          user_id   TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          location  TEXT DEFAULT '',
          synced    INTEGER DEFAULT 0
        )
      `);
      tx.executeSql(`
        CREATE INDEX IF NOT EXISTS idx_att_synced ON attendance(synced, timestamp)
      `);
    });
  }

  // ── Users ──────────────────────────────────────────────────────────────

  async enrollUser(id: string, name: string, embedding: Float32Array): Promise<void> {
    const db  = await this.ready();
    const b64 = float32ToB64(embedding);
    await db.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO users (id, name, embedding, enrolled_at) VALUES (?,?,?,?)`,
        [id, name, b64, Date.now()],
      );
    });
  }

  async getEmbedding(userId: string): Promise<Float32Array | null> {
    const db       = await this.ready();
    const [result] = await db.executeSql(
      `SELECT embedding FROM users WHERE id = ?`, [userId],
    );
    if (result.rows.length === 0) return null;
    return b64ToFloat32(result.rows.item(0).embedding as string);
  }

  async userExists(id: string): Promise<boolean> {
    const db       = await this.ready();
    const [result] = await db.executeSql(
      `SELECT 1 FROM users WHERE id = ? LIMIT 1`, [id],
    );
    return result.rows.length > 0;
  }

  async getAllUsers(): Promise<Array<{ id: string; name: string }>> {
    const db       = await this.ready();
    const [result] = await db.executeSql(`SELECT id, name FROM users ORDER BY name`);
    const out: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < result.rows.length; i++) {
      out.push({ id: result.rows.item(i).id, name: result.rows.item(i).name });
    }
    return out;
  }

  // ── Attendance ─────────────────────────────────────────────────────────

  async logAttendance(record: Omit<AttendanceRecord, 'synced'>): Promise<void> {
    const db = await this.ready();
    await db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO attendance (id, user_id, timestamp, location, synced) VALUES (?,?,?,?,0)`,
        [record.id, record.userId, record.timestamp, record.location],
      );
    });
  }

  async getUnsynced(): Promise<AttendanceRecord[]> {
    const db       = await this.ready();
    const [result] = await db.executeSql(
      `SELECT * FROM attendance WHERE synced = 0 ORDER BY timestamp ASC`,
    );
    const out: AttendanceRecord[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows.item(i);
      out.push({
        id: r.id, userId: r.user_id, timestamp: r.timestamp,
        location: r.location, synced: false,
      });
    }
    return out;
  }

  async getPendingCount(): Promise<number> {
    const db       = await this.ready();
    const [result] = await db.executeSql(
      `SELECT COUNT(*) AS cnt FROM attendance WHERE synced = 0`,
    );
    return result.rows.item(0).cnt as number;
  }

  async markSynced(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const db = await this.ready();
    const placeholders = ids.map(() => '?').join(',');
    await db.transaction(tx => {
      tx.executeSql(
        `UPDATE attendance SET synced = 1 WHERE id IN (${placeholders})`, ids,
      );
    });
  }

  async purgeSynced(): Promise<number> {
    const db       = await this.ready();
    const [r]      = await db.executeSql(
      `SELECT COUNT(*) AS cnt FROM attendance WHERE synced = 1`,
    );
    const count = r.rows.item(0).cnt as number;
    await db.transaction(tx => {
      tx.executeSql(`DELETE FROM attendance WHERE synced = 1`);
    });
    return count;
  }
}

export const db = new BiometricDatabase();
