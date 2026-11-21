import { isRecord } from "../storage/contracts";
import type { StoredItem } from "../storage/contracts";
import { isEmptySummary } from "../collection/item-edit";

export interface SyncRevision {
  readonly wallTime: number;
  readonly logical: number;
  readonly deviceId: string;
}

export interface SyncText {
  readonly value: string;
  readonly revision: SyncRevision;
  readonly manual: boolean;
}

export interface SyncMember {
  readonly id: string;
  readonly url: string;
  readonly savedAt: number;
  readonly title: SyncText;
  readonly description: SyncText;
}

export interface SyncState {
  readonly members: readonly SyncMember[];
  readonly deletedIds: readonly string[];
}

const emptyState: SyncState = { members: [], deletedIds: [] };
export const isDeviceId = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isItemId = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const cmp = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1;
const invalidState = (): never => { throw new Error("SYNC_STATE_INVALID"); };

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^https?:\/\//i.test(value) && URL.canParse(value);
}

function preferText(left: SyncText, right: SyncText): SyncText {
  const order = left.revision.wallTime - right.revision.wallTime || left.revision.logical - right.revision.logical
    || cmp(left.revision.deviceId, right.revision.deviceId) || Number(left.manual) - Number(right.manual) || cmp(left.value, right.value);
  return order >= 0 ? left : right;
}

function mergeMember(left: SyncMember, right: SyncMember): SyncMember {
  const origin = (left.savedAt - right.savedAt || cmp(left.url, right.url)) <= 0 ? left : right;
  return { id: origin.id, url: origin.url, savedAt: origin.savedAt,
    title: preferText(left.title, right.title), description: preferText(left.description, right.description) };
}

export function mergeSyncStates(left: SyncState, right: SyncState): SyncState {
  const deleted = new Set([...left.deletedIds, ...right.deletedIds]);
  const members = new Map<string, SyncMember>();
  for (const state of [left, right]) {
    for (const member of state.members) {
      if (deleted.has(member.id)) continue;
      const existing = members.get(member.id);
      members.set(member.id, existing ? mergeMember(existing, member) : member);
    }
  }
  return { members: [...members.values()].sort((first, second) => cmp(first.id, second.id)), deletedIds: [...deleted].sort(cmp) };
}

function canonicalText({ value, revision: { wallTime, logical, deviceId }, manual }: SyncText): SyncText {
  return { value, revision: { wallTime, logical, deviceId }, manual };
}

export function canonicalSyncState(state: SyncState): SyncState {
  const { members, deletedIds } = mergeSyncStates(emptyState, state);
  return { members: members.map(({ id, url, savedAt, title, description }) => ({
    id, url, savedAt, title: canonicalText(title), description: canonicalText(description)
  })), deletedIds };
}

export async function hashSyncState(state: SyncState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalSyncState(state)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function isSyncText(value: unknown): value is SyncText {
  return isRecord(value) && typeof value.value === "string" && typeof value.manual === "boolean" && isRecord(value.revision)
    && isCount(value.revision.wallTime) && isCount(value.revision.logical) && isDeviceId(value.revision.deviceId);
}

function isSyncMember(value: unknown): value is SyncMember {
  return isRecord(value) && isItemId(value.id) && isWebUrl(value.url) && isCount(value.savedAt)
    && isSyncText(value.title) && isSyncText(value.description);
}

export function parseSyncState(value: unknown): SyncState {
  if (!isRecord(value) || !Array.isArray(value.members) || !value.members.every(isSyncMember)
    || !Array.isArray(value.deletedIds) || !value.deletedIds.every(isItemId)) return invalidState();
  const canonical = canonicalSyncState({ members: value.members, deletedIds: value.deletedIds });
  if (canonical.members.length !== value.members.length || canonical.deletedIds.length !== value.deletedIds.length) return invalidState();
  return canonical;
}

export function initialSyncState(items: readonly StoredItem[], deviceId: string): SyncState {
  const field = (value: string, manual: boolean): SyncText => ({
    value, manual, revision: { wallTime: 0, logical: manual ? 1 : 0, deviceId }
  });
  const members = items.filter(Boolean).map(item => ({ id: item.id, url: item.url, savedAt: item.savedAt ?? 0,
    title: field(item.title ?? "", item.titleEdited === true),
    description: field(isEmptySummary(item.description) ? "" : item.description ?? "", item.descriptionEdited === true) }));
  return parseSyncState({ members, deletedIds: [] });
}
