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

export interface PublicationKey extends Pick<PublicationIdentity, "deviceId" | "seq"> {
  readonly stateHash: string;
}

export interface SyncHead extends PublicationIdentity, PublicationKey {
  readonly version: 2;
  readonly snapshotName: string;
}

const encode = (value: object) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const publicationSuffix = ({ deviceId, seq, stateHash }: PublicationKey): string => `${deviceId}-${seq}-${stateHash}`;
export const recordName = (key: PublicationKey): string => `publication-${publicationSuffix(key)}.json`;
const snapshotName = (key: PublicationKey): string => `snapshot-${publicationSuffix(key)}.json.gz`;
const isStateHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sameIdentity = (value: Record<string, unknown>, identity: PublicationIdentity): boolean =>
  value.collectionId === identity.collectionId && value.deviceId === identity.deviceId && value.seq === identity.seq;
const unverified = (): never => { throw new Error("SYNC_UNVERIFIED"); };
export const encodeSyncHead = (head: SyncHead): Uint8Array<ArrayBuffer> => encode(head);

export function parsePublicationFile(name: string): (PublicationKey & { readonly kind: "publication" | "snapshot" }) | undefined {
  const match = /^(publication|snapshot)-([a-f0-9-]{36})-([1-9][0-9]{0,15})-([a-f0-9]{64})\.json(?:\.gz)?$/.exec(name);
  if (!match) return;
  const [, kind, deviceId, generation, stateHash] = match;
  const seq = Number(generation);
  if (!isDeviceId(deviceId) || !isCount(seq) || !isStateHash(stateHash)) return;
  const key = { deviceId, seq, stateHash };
  if (kind === "publication" && recordName(key) === name) return { ...key, kind };
  if (kind === "snapshot" && snapshotName(key) === name) return { ...key, kind };
}

export async function createPublication(identity: PublicationIdentity, state: SyncState): Promise<{
  readonly head: SyncHead;
  readonly snapshotBytes: Uint8Array<ArrayBuffer>;
}> {
  const canonical = canonicalSyncState(state);
  const data = encode({ version: 1, ...identity, state: canonical });
  if (data.byteLength > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const compressed = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  const key = { ...identity, stateHash: await hashSyncState(canonical) };
  const head: SyncHead = { version: 2, ...key, snapshotName: snapshotName(key) };
  return { head, snapshotBytes: new Uint8Array(await new Response(compressed).arrayBuffer()) };
}

export function parseSyncHead(bytes: Uint8Array): SyncHead {
  const value = decode(bytes);
  if (!isRecord(value) || value.version !== 2 || !isDeviceId(value.collectionId) || !isDeviceId(value.deviceId)
    || !isCount(value.seq) || value.seq === 0 || !isStateHash(value.stateHash)) return unverified();
  const key = { collectionId: value.collectionId, deviceId: value.deviceId, seq: value.seq, stateHash: value.stateHash };
  if (value.snapshotName !== snapshotName(key)) return unverified();
  return { version: 2, ...key, snapshotName: value.snapshotName };
}

export const samePublicationKey = (left: PublicationKey, right: PublicationKey): boolean =>
  left.deviceId === right.deviceId && left.seq === right.seq && left.stateHash === right.stateHash;

export const sameSyncHead = (left: SyncHead, right: SyncHead): boolean => left.version === right.version
  && left.collectionId === right.collectionId && left.snapshotName === right.snapshotName && samePublicationKey(left, right);

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
