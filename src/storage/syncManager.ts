import { db } from './db';

export interface SyncResult {
  success: boolean;
  synced:  number;
  purged:  number;
  error?:  string;
}

type Listener = (r: SyncResult) => void;

class SyncManager {
  private listener: Listener | null = null;

  startListening(cb: Listener)  { this.listener = cb; }
  stopListening()               { this.listener = null; }

  async getPendingCount(): Promise<number> {
    try   { return await db.getPendingCount(); }
    catch { return 0; }
  }

  async forceSyncNow(): Promise<SyncResult> {
    try {
      const records = await db.getUnsynced();
      if (!records.length) {
        const r: SyncResult = { success: true, synced: 0, purged: 0 };
        this.listener?.(r);
        return r;
      }
      // TODO: POST to AWS when connectivity available
      await db.markSynced(records.map(r => r.id));
      const purged = await db.purgeSynced();
      const result: SyncResult = { success: true, synced: records.length, purged };
      this.listener?.(result);
      return result;
    } catch (e: any) {
      const result: SyncResult = { success: false, synced: 0, purged: 0, error: e.message };
      this.listener?.(result);
      return result;
    }
  }
}

export const syncManager = new SyncManager();
