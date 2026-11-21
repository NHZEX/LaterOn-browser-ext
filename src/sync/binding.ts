import { SYNC_META } from "./acceptance";
import type { SyncHead } from "./publication";
import type { SyncState } from "./state";

export interface PendingPublication {
  readonly head: SyncHead;
  readonly baseVersion: string;
}

export interface SyncBinding {
  readonly endpoint: string;
  readonly collectionId: string;
  readonly bindingId: string;
  readonly joined?: boolean;
  readonly state?: SyncState;
  readonly seen?: readonly SyncHead[];
  readonly pending?: PendingPublication;
  readonly confirmed?: PendingPublication;
}

export interface SyncMeta {
  readonly deviceId: string;
  readonly allocatedSeq: number;
  readonly detachedId?: string;
  readonly binding?: SyncBinding;
}

export async function readMeta(): Promise<SyncMeta | undefined> {
  return (await chrome.storage.local.get<{ readonly [SYNC_META]?: SyncMeta }>(SYNC_META))[SYNC_META];
}

export async function detachSyncPatch(): Promise<{ readonly [SYNC_META]?: SyncMeta }> {
  const previous = await readMeta();
  const { deviceId = crypto.randomUUID(), allocatedSeq = 0 } = previous ?? {};
  return { [SYNC_META]: { deviceId, allocatedSeq, detachedId: crypto.randomUUID() } };
}
