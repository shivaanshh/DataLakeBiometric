import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabase({ name: 'biometric.db', location: 'default' });
  await _db.executeSql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      embedding TEXT NOT NULL,
      enrolled_at INTEGER NOT NULL
    )
  `);
  await _db.executeSql(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      location TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    )
  `);
  return _db;
}

export function encodeEmbedding(v: Float32Array): string {
  return JSON.stringify(Array.from(v));
}

export function decodeEmbedding(s: string): Float32Array {
  return new Float32Array(JSON.parse(s));
}

export async function saveUser(id: string, name: string, embedding: Float32Array): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'INSERT OR REPLACE INTO users (id, name, embedding, enrolled_at) VALUES (?, ?, ?, ?)',
    [id, name, encodeEmbedding(embedding), Date.now()],
  );
}

export async function getUser(id: string): Promise<{ id: string; name: string; embedding: Float32Array } | null> {
  const db = await getDb();
  const [result] = await db.executeSql('SELECT * FROM users WHERE id = ?', [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows.item(0);
  return { id: row.id, name: row.name, embedding: decodeEmbedding(row.embedding) };
}

export async function logAttendance(userId: string, location?: string): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'INSERT INTO attendance (user_id, timestamp, location, synced) VALUES (?, ?, ?, 0)',
    [userId, Date.now(), location ?? null],
  );
}

export async function getPendingAttendance(): Promise<{ id: number; user_id: string; timestamp: number; location: string | null }[]> {
  const db = await getDb();
  const [result] = await db.executeSql('SELECT * FROM attendance WHERE synced = 0 ORDER BY timestamp ASC');
  const rows: { id: number; user_id: string; timestamp: number; location: string | null }[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    rows.push(result.rows.item(i));
  }
  return rows;
}

export async function markSynced(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  await db.executeSql(`UPDATE attendance SET synced = 1 WHERE id IN (${placeholders})`, ids);
}
