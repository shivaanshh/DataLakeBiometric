import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

export interface AttendanceRecord {
  id:        string;
  userId:    string;
  timestamp: number;
  location:  string;
  synced:    boolean;
}

// Hermes has no Buffer or btoa — use JSON array for Float32Array
function encodeEmbedding(v: Float32Array): string {
  return JSON.stringify(Array.from(v));
}
function decodeEmbedding(s: string): Float32Array {
  return new Float32Array(JSON.parse(s) as number[]);
}

class Database {
  private _db: SQLite.SQLiteDatabase | null = null;
  private _init: Promise<void> | null = null;

  private async open(): Promise<SQLite.SQLiteDatabase> {
    if (this._db) return this._db;
    if (!this._init) this._init = this._setup();
    await this._init;
    return this._db!;
  }

  private async _setup(): Promise<void> {
    this._db = await SQLite.openDatabase({ name: 'biometric.db', location: 'default' });
    await this._db.transaction(tx => {
      tx.executeSql(`CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        embedding   TEXT NOT NULL,
        enrolled_at INTEGER NOT NULL
      )`);
      tx.executeSql(`CREATE TABLE IF NOT EXISTS attendance (
        id        TEXT PRIMARY KEY,
        user_id   TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        location  TEXT DEFAULT '',
        synced    INTEGER DEFAULT 0
      )`);
    });
  }

  async enrollUser(id: string, name: string, embedding: Float32Array): Promise<void> {
    const db = await this.open();
    await db.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO users (id, name, embedding, enrolled_at) VALUES (?,?,?,?)`,
        [id, name, encodeEmbedding(embedding), Date.now()],
      );
    });
  }

  async getEmbedding(userId: string): Promise<Float32Array | null> {
    const db = await this.open();
    const [res] = await db.executeSql(`SELECT embedding FROM users WHERE id=?`, [userId]);
    if (res.rows.length === 0) return null;
    return decodeEmbedding(res.rows.item(0).embedding);
  }

  async userExists(id: string): Promise<boolean> {
    const db = await this.open();
    const [res] = await db.executeSql(`SELECT 1 FROM users WHERE id=? LIMIT 1`, [id]);
    return res.rows.length > 0;
  }

  async getAllUsers(): Promise<Array<{ id: string; name: string }>> {
    const db = await this.open();
    const [res] = await db.executeSql(`SELECT id, name FROM users ORDER BY name`);
    const out: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < res.rows.length; i++) out.push(res.rows.item(i));
    return out;
  }

  async logAttendance(r: Omit<AttendanceRecord, 'synced'>): Promise<void> {
    const db = await this.open();
    await db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO attendance (id,user_id,timestamp,location,synced) VALUES (?,?,?,?,0)`,
        [r.id, r.userId, r.timestamp, r.location],
      );
    });
  }

  async getUnsynced(): Promise<AttendanceRecord[]> {
    const db = await this.open();
    const [res] = await db.executeSql(
      `SELECT * FROM attendance WHERE synced=0 ORDER BY timestamp`,
    );
    const out: AttendanceRecord[] = [];
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows.item(i);
      out.push({ id: r.id, userId: r.user_id, timestamp: r.timestamp, location: r.location, synced: false });
    }
    return out;
  }

  async getPendingCount(): Promise<number> {
    const db = await this.open();
    const [res] = await db.executeSql(`SELECT COUNT(*) AS n FROM attendance WHERE synced=0`);
    return res.rows.item(0).n as number;
  }

  async markSynced(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const db = await this.open();
    const ph = ids.map(() => '?').join(',');
    await db.transaction(tx => {
      tx.executeSql(`UPDATE attendance SET synced=1 WHERE id IN (${ph})`, ids);
    });
  }

  async purgeSynced(): Promise<number> {
    const db = await this.open();
    const [r] = await db.executeSql(`SELECT COUNT(*) AS n FROM attendance WHERE synced=1`);
    const n = r.rows.item(0).n as number;
    await db.transaction(tx => { tx.executeSql(`DELETE FROM attendance WHERE synced=1`); });
    return n;
  }
}

export const db = new Database();
