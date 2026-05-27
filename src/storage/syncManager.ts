/**
 * syncManager.ts
 *
 * Manages offline-to-online sync with AWS.
 *
 * Flow:
 *   1. NetInfo detects network restoration
 *   2. Fetch all unsynced attendance records from SQLite
 *   3. Batch-write to DynamoDB (25 records per batch — AWS limit)
 *   4. Mark records as synced in SQLite
 *   5. Hard-delete (purge) synced records from SQLite
 *
 * AWS resources required:
 *   - DynamoDB table: AttendanceRecords (partition key: id)
 *   - S3 bucket: for optional audit log archival
 *   - IAM role with PutItem + BatchWriteItem on the table
 *
 * TODO for Claude Code:
 *   - Replace AWS credentials with environment variables / Cognito Identity Pool
 *   - Add S3 archival step if required by Datalake 3.0 backend
 *   - Implement exponential backoff for failed batches
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { db, AttendanceRecord }  from './db';

// ─── AWS CONFIG — replace with your values ─────────────────────────────────
const AWS_REGION     = 'ap-south-1';
const DYNAMODB_TABLE = 'DatalakeAttendanceRecords';
const S3_BUCKET      = 'datalake-biometric-sync';
const BATCH_SIZE     = 25; // DynamoDB BatchWriteItem hard limit

// ─── Types ─────────────────────────────────────────────────────────────────
export interface SyncResult {
  success:  boolean;
  synced:   number;
  purged:   number;
  error?:   string;
}

// ─── SyncManager ───────────────────────────────────────────────────────────
export class SyncManager {
  private unsubscribeNetInfo: (() => void) | null = null;
  private isSyncing = false;
  private onSyncComplete?: (result: SyncResult) => void;

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  /** Start listening for network changes. Call once on app start. */
  startListening(onComplete?: (result: SyncResult) => void): void {
    this.onSyncComplete = onComplete;
    this.unsubscribeNetInfo = NetInfo.addEventListener(this.handleNetworkChange);
    console.log('[SyncManager] Network listener started.');
  }

  stopListening(): void {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    console.log('[SyncManager] Network listener stopped.');
  }

  private handleNetworkChange = async (state: NetInfoState): Promise<void> => {
    if (state.isConnected && state.isInternetReachable && !this.isSyncing) {
      console.log('[SyncManager] Network restored. Starting sync...');
      const result = await this.syncAll();
      this.onSyncComplete?.(result);
    }
  };

  // ─── Core Sync Logic ───────────────────────────────────────────────────

  async syncAll(): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: false, synced: 0, purged: 0, error: 'Sync already in progress' };
    }

    this.isSyncing = true;

    try {
      const records = await db.getUnsynced();

      if (records.length === 0) {
        console.log('[SyncManager] Nothing to sync.');
        return { success: true, synced: 0, purged: 0 };
      }

      console.log(`[SyncManager] Syncing ${records.length} records...`);

      let totalSynced = 0;

      // Process in batches of 25 (DynamoDB limit)
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch     = records.slice(i, i + BATCH_SIZE);
        const batchIds  = batch.map(r => r.id);

        try {
          await this.writeBatchToDynamoDB(batch);
          await db.markSynced(batchIds);
          totalSynced += batch.length;
          console.log(`[SyncManager] Batch ${Math.floor(i / BATCH_SIZE) + 1} synced (${batch.length} records).`);
        } catch (batchErr) {
          // Don't abort — continue with remaining batches
          console.error(`[SyncManager] Batch failed, will retry next time:`, batchErr);
        }
      }

      // Purge confirmed synced records
      const purged = await db.purgeSync();
      console.log(`[SyncManager] Purged ${purged} synced records from local storage.`);

      return { success: true, synced: totalSynced, purged };
    } catch (err: any) {
      console.error('[SyncManager] Sync failed:', err);
      return { success: false, synced: 0, purged: 0, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /** Force a manual sync (e.g., from a "Sync Now" button in the UI) */
  async forceSyncNow(): Promise<SyncResult> {
    const state = await NetInfo.fetch();
    if (!state.isConnected || !state.isInternetReachable) {
      return {
        success: false,
        synced:  0,
        purged:  0,
        error:   'No internet connection available',
      };
    }
    return this.syncAll();
  }

  // ─── AWS Operations ─────────────────────────────────────────────────────

  /**
   * Write a batch of attendance records to DynamoDB.
   *
   * TODO: Replace fetch() call with proper AWS SDK v3 or Amplify call.
   * This stub uses the raw DynamoDB API endpoint for clarity.
   *
   * In production, use:
   *   import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
   */
  private async writeBatchToDynamoDB(records: AttendanceRecord[]): Promise<void> {
    const requestItems = {
      [DYNAMODB_TABLE]: records.map(r => ({
        PutRequest: {
          Item: {
            id:        { S: r.id },
            userId:    { S: r.userId },
            timestamp: { N: String(r.timestamp) },
            location:  { S: r.location ?? '' },
            deviceId:  { S: r.deviceId ?? '' },
            syncedAt:  { N: String(Date.now()) },
          },
        },
      })),
    };

    /**
     * TODO: Wire up AWS SDK v3.
     *
     * const client  = new DynamoDBClient({ region: AWS_REGION });
     * const command = new BatchWriteItemCommand({ RequestItems: requestItems });
     * const result  = await client.send(command);
     *
     * if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
     *   throw new Error('Some items were not processed — retry required');
     * }
     */

    console.log('[SyncManager] DynamoDB write (stub):', JSON.stringify(requestItems, null, 2));
    // Stub: resolves immediately
    await new Promise(res => setTimeout(res, 100));
  }

  /** Get pending sync count for UI badge */
  async getPendingCount(): Promise<number> {
    const records = await db.getUnsynced();
    return records.length;
  }
}

export const syncManager = new SyncManager();
