import type { StoredItem } from "../storage/contracts";
import { isInlineIcon } from "../storage/icons.ts";

export type ReadingStatus = NonNullable<StoredItem["status"]>;
type LegacyItemState = Readonly<Pick<StoredItem, "status" | "read" | "doneAt">>;

export interface ItemState {
  readonly status: ReadingStatus;
  readonly doneAt: number | null;
}

/** Display normalization never starts or resets the persisted cleanup clock. */
export function normalizeItemState(item: LegacyItemState): ItemState {
  const status = item.status || (item.read ? "done" : "unread");
  return { status, doneAt: status === "done" ? Number(item.doneAt) || null : null };
}

export function normalizeItems<T extends StoredItem>(list: readonly (T | null | undefined)[] | null | undefined): (T & ItemState)[] {
  return (list || []).filter((item): item is T => !!item).map(item => ({ ...item, ...normalizeItemState(item) }));
}

// 手动按钮在未完成 / 已完成之间切换；点开原文才进入 reading，点过但没读完仍属于未完成。
export function nextStatus(status: ReadingStatus): "unread" | "done" {
  return status === "done" ? "unread" : "done";
}

/** Both pages request the same queued migration; only the worker supplies missing timestamps. */
export function needsLegacyMigration(list: readonly (StoredItem | null | undefined)[] | null | undefined): boolean {
  return Array.isArray(list) && list.some(item =>
    !item || isInlineIcon(item.favicon) || (typeof item.image === "string" && item.image.startsWith("data:"))
    || (normalizeItemState(item).status === "done" && !Number(item.doneAt)));
}
