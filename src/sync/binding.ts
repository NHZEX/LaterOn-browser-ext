import { SYNC_META, syncEnabled } from "./acceptance";
import type { SyncHead } from "./publication";
import type { SyncClock, SyncState } from "./state";

export interface PendingPublication {
  readonly head: SyncHead;
  readonly baseVersion: string;
}

export interface SyncBinding {
  readonly endpoint: string;
  readonly credentials?: { readonly username: string; readonly password: string };
  readonly collectionId: string;
  readonly bindingId: string;
  readonly joined?: boolean;
  readonly state?: SyncState;
  readonly seen?: readonly SyncHead[];
  readonly pending?: PendingPublication;
  readonly confirmed?: PendingPublication;
  readonly localPublications?: readonly SyncHead[];
  readonly paused?: true;
}

export interface SyncMeta {
  readonly deviceId: string;
  readonly allocatedSeq: number;
  readonly trialEnabled?: true;
  readonly clock?: SyncClock;
  readonly detachedId?: string;
  readonly detachedHeads?: { readonly collectionId: string; readonly heads: readonly SyncHead[];
    readonly endpoint?: string; readonly localPublications?: readonly SyncHead[] };
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

export async function detachSyncPatch({ preserveVerifiedHeads = false, disableTrial = false, collectionReset = false } = {}): Promise<{ readonly [SYNC_META]?: SyncMeta }> {
  const previous = await readMeta();
  if (collectionReset && !syncEnabled(previous) && !previous?.binding) return {};
  const { deviceId = crypto.randomUUID(), allocatedSeq = 0, clock, binding } = previous ?? {};
  const detachedHeads = binding ? { collectionId: binding.collectionId, heads: verifiedHeads(binding), endpoint: binding.endpoint,
    ...(binding.localPublications ? { localPublications: binding.localPublications } : {}) } : previous?.detachedHeads;
  return { [SYNC_META]: { deviceId, allocatedSeq, ...(clock ? { clock } : {}), detachedId: crypto.randomUUID(),
    ...(!disableTrial && previous?.trialEnabled ? { trialEnabled: true } : {}),
    ...(preserveVerifiedHeads && detachedHeads?.heads.length ? { detachedHeads } : {}) } };
}
