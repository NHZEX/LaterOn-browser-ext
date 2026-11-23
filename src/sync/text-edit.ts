import { safeHostname } from "../background/shared";
import { isEmptySummary } from "../collection/item-edit";
import { ITEM_TEXT_FIELDS } from "../storage/contracts";
import type { ItemChanges, ItemEditBasis, ItemTextField, StoredItem } from "../storage/contracts";
import { captureEditBasis } from "../storage/edit-recovery";
import type { EditRecoveryEntry } from "../storage/edit-recovery";
import type { SyncBinding, SyncMeta } from "./binding";
import { compareText, encodeHandwrittenRevision, initialSyncState, mergeSyncStates, seedItemText, stateClock, textEditFlags, tickClock, zeroClock } from "./state";
import type { SyncMember, SyncRevision, SyncState, SyncText } from "./state";

type BoundMeta = SyncMeta & { readonly binding: SyncBinding };
const indexMembers = (state?: SyncState) => new Map((state?.members ?? []).map(member => [member.id, member]));

export function editView(meta: BoundMeta) {
  return { bindingId: meta.binding.bindingId, deviceId: meta.deviceId, members: indexMembers(meta.binding.state) };
}

export type SyncEditView = ReturnType<typeof editView>;

export function projectItemText(item: StoredItem, members: readonly StoredItem[], view?: SyncEditView) {
  if (!view) return { item, basis: captureEditBasis(item) };
  const source = (field: ItemTextField) => {
    const text = (member: StoredItem) => view.members.get(member.id)?.[field] ?? seedItemText(member, field, view.deviceId);
    const winner = members.reduce((chosen, candidate) => compareText(text(candidate), text(chosen)) > 0 ? candidate : chosen, item);
    const stamp = text(winner).revision;
    return { sourceId: winner.id, value: winner[field] ?? null,
      revision: JSON.stringify([stamp.wallTime, stamp.logical, stamp.deviceId, winner.editRevisions?.[field]]) };
  };
  const title = source("title"), description = source("description");
  return { item: { ...item, title: title.value ?? undefined, description: description.value ?? undefined },
    basis: { bindingId: view.bindingId, title, description } };
}

function withItemText(item: StoredItem, field: ItemTextField, value: string, manual: boolean, remoteAuthor?: string): StoredItem {
  const { textAuthors, ...rest } = item;
  const { [field]: _author, ...others } = textAuthors ?? {};
  const authors = remoteAuthor ? { ...others, [field]: remoteAuthor } : others;
  return { ...rest, [field]: value, [textEditFlags[field]]: manual, ...(Object.keys(authors).length ? { textAuthors: authors } : {}) };
}

function withHandwrittenText(item: StoredItem, field: ItemTextField, value: string, revision: SyncRevision): StoredItem {
  return { ...withItemText(item, field, value, true), editRevisions: { ...item.editRevisions, [field]: encodeHandwrittenRevision(revision) } };
}

export function writeUnboundHandwrittenEdit(meta: SyncMeta | undefined, item: StoredItem, patch: ItemChanges, now: number,
  newDeviceId: () => string): { readonly item: StoredItem; readonly meta: SyncMeta } | undefined {
  const changes = ITEM_TEXT_FIELDS.flatMap(field => {
    const value = patch[field];
    return value !== undefined && patch[textEditFlags[field]] === true ? [{ field, value }] : [];
  });
  if (!changes.length) return;
  const current = meta ?? { deviceId: newDeviceId(), allocatedSeq: 0 };
  const clock = tickClock(current.clock ?? zeroClock, now);
  const revision = { ...clock, deviceId: current.deviceId };
  return { item: changes.reduce((next, { field, value }) => withHandwrittenText(next, field, value, revision), item),
    meta: { ...current, clock } };
}

export function planSyncEdit(id: string, current: ReturnType<typeof projectItemText> | undefined, basis: ItemEditBasis, patch: ItemChanges, now: number) {
  const drafts: EditRecoveryEntry[] = [];
  const changes = new Map<string, Partial<Record<ItemTextField, string>>>();
  for (const field of ITEM_TEXT_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    const version = current?.basis[field];
    const displayed = version?.value;
    if (value === displayed || (field === "description" && isEmptySummary(value) && (displayed == null || isEmptySummary(displayed)))) continue;
    if (!version?.sourceId || basis.bindingId !== current?.basis.bindingId || basis[field].sourceId !== version.sourceId
      || basis[field].revision !== version.revision || basis[field].value !== version.value) {
      drafts.push({ itemId: basis[field].sourceId ?? id, title: current?.item.title ?? basis.title.value ?? "",
        field, value, kind: "draft", createdAt: now });
      continue;
    }
    changes.set(version.sourceId, { ...changes.get(version.sourceId), [field]: field === "description" && isEmptySummary(value) ? "" : value });
  }
  return { changes, drafts };
}

export function writeSyncEdit(meta: BoundMeta, items: readonly StoredItem[], changes: ReturnType<typeof planSyncEdit>["changes"], now: number) {
  const state = meta.binding.state;
  const existing = indexMembers(state);
  const seeds = initialSyncState(items.filter(item => changes.has(item.id) && !existing.has(item.id)), meta.deviceId);
  const clock = tickClock(stateClock(state, meta.clock), now);
  const revision = { ...clock, deviceId: meta.deviceId };
  const base = mergeSyncStates(state ?? { members: [], deletedIds: [] }, seeds);
  const update = (member: SyncMember, field: ItemTextField): SyncText => {
    const value = changes.get(member.id)?.[field];
    return value === undefined ? member[field] : { revision, value, manual: true };
  };
  const edited = items.map(item => ITEM_TEXT_FIELDS.reduce((next, field) => {
    const value = changes.get(item.id)?.[field];
    return value === undefined ? next : withHandwrittenText(next, field, value, revision);
  }, item));
  const members = base.members.map(member => changes.has(member.id)
    ? { ...member, title: update(member, "title"), description: update(member, "description") } : member);
  return { items: edited, meta: { ...meta, clock, binding: { ...meta.binding, state: { ...base, members } } } };
}

export function receiveSyncText(items: readonly StoredItem[], previous: SyncState, state: SyncState, deviceId: string, now: number) {
  const before = indexMembers(previous), after = indexMembers(state);
  const records: EditRecoveryEntry[] = [];
  const tombstones = new Set(state.deletedIds);
  const removed = new Set<string>();
  const next = items.flatMap(item => {
    if (!item) return [item];
    const old = before.get(item.id), incoming = after.get(item.id);
    if (tombstones.has(item.id)) {
      removed.add(item.id);
      for (const field of ITEM_TEXT_FIELDS) {
        const loser = old?.[field];
        if (loser?.manual && loser.revision.deviceId === deviceId) records.push({ itemId: item.id,
          title: item.title ?? "", field, value: loser.value, kind: "overwritten", createdAt: now });
      }
      return [];
    }
    if (!old || !incoming) return item;
    return ITEM_TEXT_FIELDS.reduce((updated, field) => {
      const winner = incoming[field], loser = old[field];
      const author = winner.manual && winner.revision.deviceId !== deviceId ? winner.revision.deviceId : undefined;
      if (compareText(winner, loser) === 0) {
        const sameValue = item[field] === winner.value || (field === "description" && winner.value === "" && isEmptySummary(item[field]));
        return winner.manual && (item[textEditFlags[field]] !== true || !sameValue || item.textAuthors?.[field] !== author)
          ? withItemText(updated, field, winner.value, true, author)
          : updated;
      }
      if (loser.manual && loser.revision.deviceId === deviceId && loser.value !== winner.value) records.push({ itemId: item.id,
        title: item.title ?? "", field, value: loser.value, kind: "overwritten", createdAt: now });
      return withItemText(updated, field, winner.value, winner.manual, author);
    }, item);
  });
  const known = new Set([...items.flatMap(item => item ? [item.id] : []), ...before.keys()]);
  const added = state.members.filter(member => !known.has(member.id)).map(member => {
    const item: StoredItem = { id: member.id, url: member.url, savedAt: member.savedAt,
      source: safeHostname(member.url), status: "unread", projectId: null };
    return ITEM_TEXT_FIELDS.reduce((updated, field) => withItemText(updated, field, member[field].value, member[field].manual,
      member[field].manual && member[field].revision.deviceId !== deviceId ? member[field].revision.deviceId : undefined), item);
  });
  return { items: [...next, ...added], records, added: added.length, removed };
}
