import { browser } from "wxt/browser";
import { needsLegacyMigration, normalizeItems } from "../collection/item-state";
import { normalizeFilter } from "../collection/filter";
import { ITEMS, PROJECTS, COVERS, CURRENT, ACTIVE, ORDER, EPOCH } from "../storage/contracts";
import type { CollectionSuccess } from "../storage/contracts";
import { FILTER, FILTER_CHOSEN, SETTINGS, type PanelSnapshot } from "./page";
import { normalizePanelProject } from "./shared";
import type { SidepanelControls } from "./useSidepanelControls";

export function usePanelStorage(controls: SidepanelControls, onItems: () => void) {
  let alive = true, ready = false, mounted = false, coverVersion = 0;
  let pending: PanelSnapshot = {};
  const initialPreferences = { ...controls.preferenceVersion };
  const broadcastPreferences: { filter?: number; project?: number } = {};
  function apply(snapshot: PanelSnapshot, initial = false): void {
    const previous = controls.collection.value;
    const projects = PROJECTS in snapshot ? (snapshot[PROJECTS] ?? []).filter(project => !project.archived) : previous.projects;
    if (initial || ACTIVE in snapshot || PROJECTS in snapshot) controls.state.project = normalizePanelProject(ACTIVE in snapshot ? snapshot[ACTIVE] : controls.state.project, projects);
    // 两页共享筛选；首次未选择时默认未读，异常值仍规范为三档。
    if (initial) controls.state.filter = snapshot[FILTER_CHOSEN] ? normalizeFilter(snapshot[FILTER]) : "unread";
    else if (FILTER in snapshot) controls.state.filter = normalizeFilter(snapshot[FILTER]);
    if (ITEMS in snapshot || PROJECTS in snapshot || ORDER in snapshot || SETTINGS in snapshot) controls.collection.value = {
      items: ITEMS in snapshot ? normalizeItems(snapshot[ITEMS]) : previous.items, projects,
      archivedProjectIds: PROJECTS in snapshot ? new Set((snapshot[PROJECTS] ?? []).filter(project => project.archived).map(project => project.id)) : previous.archivedProjectIds,
      orders: ORDER in snapshot ? snapshot[ORDER] ?? {} : previous.orders,
      sortMode: SETTINGS in snapshot ? snapshot[SETTINGS]?.defaultSort ?? "newest" : previous.sortMode
    };
    if (COVERS in snapshot) { coverVersion++; controls.covers.value = snapshot[COVERS] ?? {}; }
    if (SETTINGS in snapshot) controls.autoMarkRead.value = snapshot[SETTINGS]?.autoMarkRead !== false;
    if (CURRENT in snapshot) controls.locate(snapshot[CURRENT] ?? null);
    controls.ready.value = true;
  }
  const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (!alive || area !== "local") return;
    const patch = Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])) as PanelSnapshot;
    // 订阅早于读取：初始化 / 迁移期间收到的广播覆盖旧快照，而不是被晚到读取回滚。
    if (!ready) {
      pending = { ...pending, ...patch };
      if (FILTER in patch) broadcastPreferences.filter = controls.preferenceVersion.filter;
      if (ACTIVE in patch) broadcastPreferences.project = controls.preferenceVersion.project;
    }
    else {
      apply(patch);
      if (ITEMS in patch && !(CURRENT in patch)) onItems(); // 明确的阅读标记优先，不能被当前标签同步回写。
      if (CURRENT in patch) controls.locate(patch[CURRENT] ?? null); // 同批明确阅读标记优先。
    }
  };
  function mount(): void { if (!mounted) { mounted = true; browser.storage.onChanged.addListener(changed); } }
  // 封面可能大于整个列表，故意不在初始读取中；先让列表最快出来。
  function read(): Promise<PanelSnapshot> { return browser.storage.local.get<PanelSnapshot>([ITEMS, PROJECTS, ACTIVE, CURRENT, SETTINGS, FILTER, FILTER_CHOSEN, ORDER, EPOCH]); }
  // 缓存可操作时本地选择和外部切换都可能先于读取返回，按最后发生的一次恢复。
  function latest(snapshot: PanelSnapshot): PanelSnapshot {
    const localPreferences: PanelSnapshot = {
      ...(controls.preferenceVersion.filter !== initialPreferences.filter && controls.preferenceVersion.filter !== broadcastPreferences.filter ? { [FILTER]: controls.state.filter, [FILTER_CHOSEN]: true } : {}),
      ...(controls.preferenceVersion.project !== initialPreferences.project && controls.preferenceVersion.project !== broadcastPreferences.project ? { [ACTIVE]: controls.state.project } : {})
    };
    return { ...snapshot, ...pending, ...localPreferences };
  }
  async function restore(snapshot: PanelSnapshot): Promise<void> {
    globalThis.LaterOnStorage.initialize(snapshot);
    let migrated: CollectionSuccess | null = null;
    // 一次性将列表里的 base64 封面搬到独立键；已迁移不重写，失败仍展示原数据。
    if (needsLegacyMigration(snapshot[ITEMS])) {
      try { migrated = await globalThis.LaterOnStorage.run("migrateLegacyData"); } catch { /* 原始数据仍可使用。 */ }
    }
    if (!alive) return;
    apply(latest({ ...snapshot, ...(migrated?.items ? { [ITEMS]: migrated.items } : {}), ...(migrated?.covers ? { [COVERS]: migrated.covers } : {}) }), true);
    pending = {}; ready = true;
  }
  function failed(): void { if (alive) { apply(latest({})); pending = {}; ready = true; } }
  async function loadCovers(): Promise<void> {
    const version = coverVersion;
    try {
      const stored = await browser.storage.local.get<PanelSnapshot>(COVERS);
      // 初始封面读取不能覆盖等待期间更新的广播或命令响应。
      if (alive && version === coverVersion) apply({ [COVERS]: stored[COVERS] });
    } catch { /* 封面读不到就先显示占位。 */ }
  }
  function accept(response: CollectionSuccess): void {
    if (!alive) return;
    apply({ ...(response.items ? { [ITEMS]: response.items } : {}), ...(response.covers ? { [COVERS]: response.covers } : {}),
      ...(response.orders ? { [ORDER]: response.orders } : {}) });
    if (response.items && controls.currentId.value && !response.items.some(item => item.id === controls.currentId.value)) controls.locate(null);
  }
  function dispose(): void { alive = false; pending = {}; if (mounted) browser.storage.onChanged.removeListener(changed); }
  return { mount, read, restore, failed, loadCovers, accept, dispose };
}
