import { sortCollectionItems } from "../shared/collection-sort";
import type { StoredItem } from "../storage/contracts";
import { isRecord } from "../storage/contracts";
import { isInlineIcon, referencedIcons, type IconMap } from "../storage/icons";
import type { PanelCollection } from "./shared";

const KEY = "laterOnPanelCache";
interface Preview { readonly items: readonly StoredItem[]; readonly icons: IconMap }
export function usePanelCache(collection: () => PanelCollection) {
  let slow = false, alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function read(): Preview | null {
    if (slow) return null;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.items) || !isRecord(parsed.icons)) return null;
      const items = parsed.items.filter((item): item is StoredItem => isRecord(item) && typeof item.id === "string");
      const icons = Object.fromEntries(Object.entries(parsed.icons).filter((entry): entry is [string, string] => /^[a-f0-9]{64}$/.test(entry[0]) && isInlineIcon(entry[1])));
      return { items, icons: referencedIcons(items, icons) };
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
        const { items, icons, archivedProjectIds } = collection();
        // 导入数组可能乱序，排除归档后取最新 12 条，不能直接截取原数组。
        const preview = sortCollectionItems(items.filter(item => !archivedProjectIds.has(item.projectId ?? "")), "newest").slice(0, 12);
        const json = JSON.stringify({ version: 2, items: preview, icons: referencedIcons(preview, icons ?? {}) });
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
