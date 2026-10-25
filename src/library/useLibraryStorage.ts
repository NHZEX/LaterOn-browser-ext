import { browser } from "wxt/browser";
import { needsLegacyMigration, normalizeItems } from "../collection/item-state";
import { ITEMS, PROJECTS, COVERS, ORDER, CURRENT, ACTIVE, EPOCH } from "../storage/contracts";
import type { CollectionSuccess } from "../storage/contracts";
import { FILTER, FILTER_CHOSEN, SETTINGS, SIDEBAR_WIDTH } from "./page";
import type { LibrarySnapshot } from "./page";
import { pinnedProjects } from "./shared";
import type { LibraryView } from "./useLibraryView";

export function useLibraryStorage(view: LibraryView, applyScope: (snapshot: LibrarySnapshot, initial: boolean) => void, failed: () => void) {
  let alive = true, mounted = false, ready = false;
  let pending: LibrarySnapshot = {};
  function apply(snapshot: LibrarySnapshot, initial = false): void {
    const previous = view.collection.value;
    if (ITEMS in snapshot || PROJECTS in snapshot || COVERS in snapshot) view.collection.value = {
      items: ITEMS in snapshot ? normalizeItems(snapshot[ITEMS]) : previous.items,
      projects: PROJECTS in snapshot ? pinnedProjects(snapshot[PROJECTS] ?? []) : previous.projects,
      // 用户上传封面体积大，独立于收藏列表存储，避免每次列表写入都搬运图片。
      covers: COVERS in snapshot ? snapshot[COVERS] ?? {} : previous.covers
    };
    // 每个范围各自保存自定义阅读顺序；其它范围的顺序不受当前排序影响。
    if (ORDER in snapshot) view.orders.value = snapshot[ORDER] ?? {};
    if (SETTINGS in snapshot) view.preferences.value = snapshot[SETTINGS] ?? {};
    applyScope(snapshot, initial);
  }
  const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (!alive || area !== "local") return;
    const patch = Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])) as LibrarySnapshot;
    // 订阅早于首次读取：初始化或迁移等待期间的广播必须覆盖旧快照。
    if (!ready) pending = { ...pending, ...patch };
    else apply(patch);
  };
  async function mount(): Promise<void> {
    if (mounted || !alive) return;
    mounted = true;
    browser.storage.onChanged.addListener(changed);
    try {
      const snapshot = await browser.storage.local.get<LibrarySnapshot>([ITEMS, PROJECTS, COVERS, ORDER, CURRENT, ACTIVE, EPOCH, SETTINGS, FILTER, FILTER_CHOSEN, SIDEBAR_WIDTH]);
      if (!alive) return;
      globalThis.LaterOnStorage.initialize(snapshot);
      // 一次性把列表中的 base64 封面迁到独立键，并由共享队列补齐旧阅读状态。
      // 已迁移的数据不重写；迁移失败时仍展示原始内容。
      let migrated: CollectionSuccess | null = null;
      if (needsLegacyMigration(snapshot[ITEMS])) {
        try { migrated = await globalThis.LaterOnStorage.run("migrateLegacyData"); } catch { /* 原数据仍可显示。 */ }
      }
      if (!alive) return;
      apply({ ...snapshot, ...(migrated?.items ? { [ITEMS]: migrated.items } : {}),
        ...(migrated?.covers ? { [COVERS]: migrated.covers } : {}), ...pending }, true);
      pending = {}; ready = true;
    } catch { if (alive) failed(); }
  }
  function accept(response: CollectionSuccess): void {
    if (!alive) return;
    apply({ ...(response.items ? { [ITEMS]: response.items } : {}), ...(response.projects ? { [PROJECTS]: response.projects } : {}),
      ...(response.covers ? { [COVERS]: response.covers } : {}), ...(response.orders ? { [ORDER]: response.orders } : {}) });
    if (response.items && !response.items.some(item => item.id === view.state.currentItemId)) view.state.currentItemId = null;
  }
  function dispose(): void { alive = false; pending = {}; if (mounted) browser.storage.onChanged.removeListener?.(changed); }
  return { mount, accept, dispose };
}
