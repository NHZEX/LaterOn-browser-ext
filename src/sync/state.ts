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

export type SyncClock = Pick<SyncRevision, "wallTime" | "logical">;
export const compareClocks = (left: SyncClock, right: SyncClock): number => left.wallTime - right.wallTime || left.logical - right.logical;
export const maxClock = (left: SyncClock, right: SyncClock): SyncClock => compareClocks(left, right) >= 0 ? left : right;
export const zeroClock: SyncClock = { wallTime: 0, logical: 0 };
export function stateClock(state: SyncState | undefined, floor = zeroClock): SyncClock {
  const { wallTime, logical } = (state?.members ?? [])
    .reduce((highest, member) => maxClock(maxClock(highest, member.title.revision), member.description.revision), floor);
  return { wallTime, logical };
}
export const compareText = (left: SyncText, right: SyncText): number => compareClocks(left.revision, right.revision)
  || cmp(left.revision.deviceId, right.revision.deviceId) || Number(left.manual) - Number(right.manual) || cmp(left.value, right.value);
const preferText = (left: SyncText, right: SyncText): SyncText => compareText(left, right) >= 0 ? left : right;

export function tickClock(previous: SyncClock, now: number): SyncClock {
  if (now > previous.wallTime) return { wallTime: now, logical: 0 };
  if (previous.logical < Number.MAX_SAFE_INTEGER) return { wallTime: previous.wallTime, logical: previous.logical + 1 };
  if (previous.wallTime < Number.MAX_SAFE_INTEGER) return { wallTime: previous.wallTime + 1, logical: 0 };
  return invalidState();
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

export function seedText(value: string | undefined, manual: boolean, deviceId: string, summary = false): SyncText {
  return { value: summary && isEmptySummary(value) ? "" : value ?? "", manual,
    revision: { wallTime: 0, logical: manual ? 1 : 0, deviceId } };
}

function reusePublishedRevision(seed: SyncText, published?: SyncText): SyncText {
  return published && seed.value === published.value && seed.manual === published.manual
    && (!seed.manual || seed.revision.deviceId === published.revision.deviceId) ? published : seed;
}

export function initialSyncState(items: readonly StoredItem[], deviceId: string, published?: SyncState): SyncState {
  const publishedMembers = new Map(published?.members.map(member => [member.id, member]));
  const members = items.filter(Boolean).map(item => {
    const known = publishedMembers.get(item.id);
    const title = seedText(item.title, item.titleEdited === true, isDeviceId(item.textAuthors?.title) ? item.textAuthors.title : deviceId);
    const description = seedText(item.description, item.descriptionEdited === true,
      isDeviceId(item.textAuthors?.description) ? item.textAuthors.description : deviceId, true);
    return { id: item.id, url: item.url, savedAt: item.savedAt ?? 0,
      title: reusePublishedRevision(title, known?.title), description: reusePublishedRevision(description, known?.description) };
  });
  return parseSyncState({ members, deletedIds: [] });
}
