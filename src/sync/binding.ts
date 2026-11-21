import { SYNC_META } from "./acceptance";
import type { SyncHead } from "./publication";
import type { SyncClock, SyncState } from "./state";

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
  readonly paused?: true;
}

export interface SyncMeta {
  readonly deviceId: string;
  readonly allocatedSeq: number;
  readonly clock?: SyncClock;
  readonly detachedId?: string;
  readonly detachedHeads?: { readonly collectionId: string; readonly heads: readonly SyncHead[] };
  readonly binding?: SyncBinding;
}

export function verifiedHeads(binding: SyncBinding): readonly SyncHead[] {
  const current = binding.confirmed?.head;
  const seen = binding.seen ?? [];
  return current ? [...seen.filter(head => head.deviceId !== current.deviceId), current] : seen;
}

export async function readMeta(): Promise<SyncMeta | undefined> {
  return (await chrome.storage.local.get<{ readonly [SYNC_META]?: SyncMeta }>(SYNC_META))[SYNC_META];
}

export async function detachSyncPatch({ preserveVerifiedHeads = false } = {}): Promise<{ readonly [SYNC_META]?: SyncMeta }> {
  const previous = await readMeta();
  const { deviceId = crypto.randomUUID(), allocatedSeq = 0, clock, binding } = previous ?? {};
  const detachedHeads = binding ? { collectionId: binding.collectionId, heads: verifiedHeads(binding) } : previous?.detachedHeads;
  return { [SYNC_META]: { deviceId, allocatedSeq, ...(clock ? { clock } : {}), detachedId: crypto.randomUUID(),
    ...(preserveVerifiedHeads && detachedHeads?.heads.length ? { detachedHeads } : {}) } };
}
