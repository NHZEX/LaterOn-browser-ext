import type { SortMode } from "../collection/filter";
import type { StoredItem } from "../storage/contracts";

// 两页共用排序规则，导入或旧数据的数组位置不能代替首次收藏时间。
export function sortCollectionItems<T extends StoredItem>(items: readonly T[], mode: SortMode, savedOrder?: readonly string[]): readonly T[] {
  const rank = new Map((Array.isArray(savedOrder) ? savedOrder : []).map((id: string, index: number) => [id, index]));
  const newest = (a: T, b: T): number => (b.savedAt ?? 0) - (a.savedAt ?? 0);
  return items.toSorted((a, b) => {
    if (mode === "oldest") return -newest(a, b);
    if (mode === "source") return (a.source ?? "").localeCompare(b.source ?? "");
    // 已排过的收藏在前；未进入保存顺序的新收藏接在后面，彼此按最新优先排列。
    if (mode === "custom") {
      const difference = (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (difference) return difference;
    }
    return newest(a, b);
  });
}
