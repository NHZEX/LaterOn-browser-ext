import { MAX_BYTES } from "../backup/core";
import { isRecord } from "../storage/contracts";
import { canonicalSyncState, hashSyncState, isCount, isDeviceId, parseSyncState } from "./state";
import type { SyncState } from "./state";

export const MAX_HEAD_BYTES = 4096;

interface PublicationIdentity {
  readonly collectionId: string;
  readonly deviceId: string;
  readonly seq: number;
}

export interface SyncHead extends PublicationIdentity {
  readonly version: 1;
  readonly snapshotName: string;
  readonly stateHash: string;
}

const encode = (value: object) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
export const headName = (deviceId: string) => `head-${deviceId}.json`;
const snapshotName = ({ deviceId, seq }: PublicationIdentity) => `snapshot-${deviceId}-${seq}.json.gz`;
const sameIdentity = (value: Record<string, unknown>, identity: PublicationIdentity): boolean =>
  value.collectionId === identity.collectionId && value.deviceId === identity.deviceId && value.seq === identity.seq;
const unverified = (): never => { throw new Error("SYNC_UNVERIFIED"); };
export const encodeSyncHead = (head: SyncHead): Uint8Array<ArrayBuffer> => encode(head);

export async function createPublication(identity: PublicationIdentity, state: SyncState): Promise<{
  readonly head: SyncHead;
  readonly headBytes: Uint8Array<ArrayBuffer>;
  readonly snapshotBytes: Uint8Array<ArrayBuffer>;
}> {
  const canonical = canonicalSyncState(state);
  const data = encode({ version: 1, ...identity, state: canonical });
  if (data.byteLength > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const compressed = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  const head: SyncHead = { version: 1, ...identity, snapshotName: snapshotName(identity), stateHash: await hashSyncState(canonical) };
  return { head, headBytes: encode(head), snapshotBytes: new Uint8Array(await new Response(compressed).arrayBuffer()) };
}

export function parseSyncHead(bytes: Uint8Array): SyncHead {
  const value = decode(bytes);
  if (!isRecord(value) || value.version !== 1 || !isDeviceId(value.collectionId) || !isDeviceId(value.deviceId)
    || !isCount(value.seq) || value.seq === 0 || typeof value.stateHash !== "string" || !/^[a-f0-9]{64}$/.test(value.stateHash)) return unverified();
  const identity = { collectionId: value.collectionId, deviceId: value.deviceId, seq: value.seq };
  if (value.snapshotName !== snapshotName(identity)) return unverified();
  return { version: 1, ...identity, snapshotName: value.snapshotName, stateHash: value.stateHash };
}

export function matchesSyncHead(bytes: Uint8Array | null, intent: SyncHead): boolean {
  return bytes !== null && sameSyncHead(parseSyncHead(bytes), intent);
}

export const sameSyncHead = (left: SyncHead, right: SyncHead): boolean => left.collectionId === right.collectionId
  && left.deviceId === right.deviceId && left.seq === right.seq && left.snapshotName === right.snapshotName && left.stateHash === right.stateHash;

export async function verifySyncSnapshot(bytes: Uint8Array<ArrayBuffer> | null, head: SyncHead): Promise<SyncState> {
  if (!bytes) return unverified();
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) return unverified();
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
  const value: unknown = JSON.parse(parts.join(""));
  if (!isRecord(value) || value.version !== 1 || !sameIdentity(value, head)) return unverified();
  const state = parseSyncState(value.state);
  if (await hashSyncState(state) !== head.stateHash) return unverified();
  return state;
}
