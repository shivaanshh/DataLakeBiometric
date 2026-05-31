import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { getPendingAttendance, markSynced } from './db';

let _unsubscribe: (() => void) | null = null;
let _onPendingChange: ((count: number) => void) | null = null;

async function syncToAWS(records: { id: number; user_id: string; timestamp: number; location: string | null }[]): Promise<void> {
  // AWS sync stub — replace with real API call
  // e.g. await fetch('https://your-api.amazonaws.com/attendance', { method: 'POST', body: JSON.stringify(records) })
  await markSynced(records.map(r => r.id));
}

export async function forceSyncNow(): Promise<void> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;
  const pending = await getPendingAttendance();
  if (pending.length === 0) return;
  await syncToAWS(pending);
  _onPendingChange?.(0);
}

export async function getPendingCount(): Promise<number> {
  const rows = await getPendingAttendance();
  return rows.length;
}

export function startListening(onPendingChange: (count: number) => void): void {
  _onPendingChange = onPendingChange;

  const handleNetChange = async (state: NetInfoState) => {
    if (state.isConnected) {
      await forceSyncNow();
      const count = await getPendingCount();
      onPendingChange(count);
    }
  };

  _unsubscribe = NetInfo.addEventListener(handleNetChange);

  // Report initial pending count
  getPendingCount().then(onPendingChange);
}

export function stopListening(): void {
  _unsubscribe?.();
  _unsubscribe = null;
  _onPendingChange = null;
}
