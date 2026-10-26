import { sortCollectionItems } from "../shared/collection-sort";
import type { StoredItem } from "../storage/contracts";
import type { PanelCollection } from "./shared";

const KEY = "laterOnPanelCache";
export function usePanelCache(collection: () => PanelCollection) {
  let slow = false, alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function read(): readonly StoredItem[] | null {
    if (slow) return null;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
      return Array.isArray(parsed) ? parsed.filter((item): item is StoredItem => !!item && typeof item === "object" && typeof item.id === "string") : null;
    } catch { return null; }
  }
  // 快照只服务下一次首屏，不是第二份数据库；12 条减轻冷读和 JSON.parse，完整存储随后校准。
  // 封面本体仍单独存储，避免每次读写列表都连图一起搬。
  function schedule(): void {
    if (!alive || slow || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!alive || slow) return;
      try {
        const { items, archivedProjectIds } = collection();
        // 导入数组可能乱序，排除归档后取最新 12 条，不能直接截取原数组。
        const preview = sortCollectionItems(items.filter(item => !archivedProjectIds.has(item.projectId ?? "")), "newest").slice(0, 12);
        const json = JSON.stringify(preview);
        if (json.length < 2000000) localStorage.setItem(KEY, json);
        else localStorage.removeItem(KEY);
      } catch { /* 可选缓存失败不影响正常使用。 */ }
    }, 300); // 下一轮事件循环再写，不挡住眼前绘制。
  }
  function disable(): void { slow = true; clearTimeout(timer); timer = undefined; }
  function probe(): boolean {
    if (slow) return false;
    try { localStorage.setItem("laterOnProbe", "1"); localStorage.removeItem("laterOnProbe"); return true; } catch { return false; }
  }
  function dispose(): void { alive = false; clearTimeout(timer); }
  return { read, schedule, disable, probe, isSlow: () => slow, dispose };
}
export type PanelCache = ReturnType<typeof usePanelCache>;
