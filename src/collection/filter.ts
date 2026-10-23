import type { StoredItem } from "../storage/contracts";

export type ReadFilter = "all" | "unread" | "done";
export type SortMode = "newest" | "oldest" | "source" | "custom";

export function normalizeFilter(value: unknown): ReadFilter {
  return value === "all" || value === "done" ? value : "unread";
}

export function normalizeSort(value: unknown): SortMode {
  return value === "oldest" || value === "source" || value === "custom" ? value : "newest";
}

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesReadFilter(item: Pick<StoredItem, "status">, filter: ReadFilter): boolean {
  return filter === "all" || (filter === "done" ? item.status === "done" : item.status !== "done");
}

export function matchesSearch(item: Pick<StoredItem, "title" | "description" | "source" | "url">, query: string): boolean {
  return !query || `${item.title ?? ""} ${item.description ?? ""} ${item.source ?? ""} ${item.url ?? ""}`.toLowerCase().includes(query);
}
