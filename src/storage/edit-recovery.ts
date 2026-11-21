import { ITEM_TEXT_FIELDS, isRecord, ITEMS, OVERRIDE_LOG } from "./contracts.ts";
import type { CollectionResponse, CollectionState, ItemChanges, ItemEditBasis, ItemTextField, StoredItem } from "./contracts";

const MAX_RECORDS = 100;
const editFlags = { title: "titleEdited", description: "descriptionEdited" } as const;

export interface EditRecoveryEntry {
  readonly itemId: string;
  readonly title: string;
  readonly field: ItemTextField;
  readonly value: string;
  readonly kind: "draft" | "overwritten" | "legacy";
  readonly createdAt: number;
}

export function captureEditBasis(item: StoredItem): ItemEditBasis {
  const version = (field: ItemTextField) => ({ value: item[field] ?? null, revision: item.editRevisions?.[field] ?? null });
  return { title: version("title"), description: version("description") };
}

export function editRecoveryNotice(outcome: CollectionResponse["editConflict"]): string | undefined {
  if (outcome === "partial") return "editRecoveryPartial";
  if (outcome === "pending") return "editRecoveryDraftSaved";
}

export function stampEditRevisions(previous: readonly StoredItem[], items: readonly StoredItem[], revision: () => string): readonly StoredItem[] {
  const byId = new Map(previous.flatMap(item => item ? [[item.id, item] as const] : []));
  return items.map(item => {
    const before = byId.get(item.id);
    if (!before) return item;
    const changed = ITEM_TEXT_FIELDS.filter(field => before[field] !== item[field]
      && before.editRevisions?.[field] === item.editRevisions?.[field]);
    if (!changed.length) return item;
    const next = revision();
    return { ...item, editRevisions: { ...item.editRevisions, ...Object.fromEntries(changed.map(field => [field, next])) } };
  });
}

export function appendEditRecovery(entries: readonly EditRecoveryEntry[], previous: readonly EditRecoveryEntry[]): readonly EditRecoveryEntry[] {
  const seen = new Set<string>();
  return [...entries, ...previous].filter(entry => {
    const key = JSON.stringify([entry.itemId, entry.field, entry.kind, entry.value]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_RECORDS);
}

export function readEditRecovery(stored: CollectionState, now: number): readonly EditRecoveryEntry[] {
  const legacy = (stored[ITEMS] ?? []).flatMap(item => {
    if (!item || !("pendingEdits" in item) || !isRecord(item.pendingEdits)) return [];
    const candidates = item.pendingEdits;
    return ITEM_TEXT_FIELDS.flatMap(field => {
      const values = candidates[field];
      if (!Array.isArray(values)) return [];
      return values.flatMap((value: unknown) => typeof value === "string" && item[field] !== value
        ? [{ itemId: item.id, title: item.title ?? "", field, value, kind: "legacy" as const, createdAt: now }] : []);
    });
  });
  return appendEditRecovery(legacy, stored[OVERRIDE_LOG] ?? []);
}

export function stripLegacyEditState(items: readonly StoredItem[]): readonly StoredItem[] {
  return items.map(item => {
    if (!item || (!("pendingEdits" in item) && !("syncText" in item))) return item;
    const { pendingEdits: _pending, syncText: _syncText, ...current } = item as StoredItem & { pendingEdits?: unknown; syncText?: unknown };
    return current;
  });
}

export function protectItemEdit(itemId: string, item: StoredItem | undefined, patch: ItemChanges, basis: ItemEditBasis, now: number): {
  readonly patch: ItemChanges;
  readonly records: readonly EditRecoveryEntry[];
  readonly conflict?: CollectionResponse["editConflict"];
} {
  const { title: _title, description: _description, titleEdited: _titleEdited, descriptionEdited: _descriptionEdited, ...rest } = patch;
  const current = item && captureEditBasis(item);
  const fields = ITEM_TEXT_FIELDS.flatMap(field => {
    const value = patch[field];
    if (value === undefined || value === current?.[field].value) return [];
    const conflict = !current || current[field].revision !== basis[field].revision || current[field].value !== basis[field].value;
    return [{ field, value, conflict }];
  });
  const records = fields.flatMap(({ field, value, conflict }) => conflict ? [{ itemId, title: item?.title ?? basis.title.value ?? "",
    field, value, kind: "draft" as const, createdAt: now }] : []);
  const accepted: ItemChanges = { ...(item ? rest : {}), ...Object.fromEntries(fields.filter(field => !field.conflict).flatMap(({ field, value }) => {
    const flag = editFlags[field];
    return [[field, value], ...(patch[flag] === undefined ? [] : [[flag, patch[flag]]])];
  })) };
  return { patch: accepted, records, ...(records.length ? { conflict: Object.keys(accepted).length ? "partial" : "pending" } : {}) };
}
