import { db } from './db';

export interface SyncResult {
  success: boolean;
  synced:  number;
  purged:  number;
  error?:  string;
}

type SyncListener = (result: SyncResult) => void;

class SyncManager {
  private listener: SyncListener | null = null;

  startListening(cb: SyncListener) { this.listener = cb; }
  stopListening()                  { this.listener = null; }

  async getPendingCount(): Promise<number> {
    try { return await db.getPendingCount(); }
    catch { return 0; }
  }

  async forceSyncNow(): Promise<SyncResult> {
    try {
      const records = await db.getUnsynced();
      if (!records.length) {
        const result: SyncResult = { success: true, synced: 0, purged: 0 };
        this.listener?.(result);
        return result;
      }
      // TODO: POST records to AWS endpoint when online
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
