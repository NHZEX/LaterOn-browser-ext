import { computed, reactive, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { normalizeFilter, normalizeSearch, type ReadFilter } from "../collection/filter";
import { panelProjects, visiblePanelItems, type PanelCollection, type PanelScope } from "./shared";

export function useSidepanelControls() {
  const state = reactive<PanelScope>({ filter: "unread", query: "", project: "unfiled" });
  const search = shallowRef("");
  const collection = shallowRef<PanelCollection>({ items: [], projects: [], archivedProjectIds: new Set(), orders: {}, sortMode: "newest" });
  const visible = computed(() => visiblePanelItems(collection.value, state));
  const projects = computed(() => panelProjects(collection.value));
  let invalidate: (() => void) | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  function update(snapshot: PanelCollection): void { if (alive) collection.value = snapshot; }
  function connect(render: () => void): void { invalidate = render; }
  function setSearch(value: string): void {
    if (!alive) return;
    search.value = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = normalizeSearch(value); invalidate?.(); }, 120);
  }
  // 筛选只认三档；首次打开或异常偏好默认未读，手动选择后供两个页面共同恢复。
  function setFilter(value: ReadFilter): void {
    if (!alive) return;
    // 本地先生效，再写共享偏好；即使没有 storage 广播，按钮和卡片也立即更新。
    state.filter = normalizeFilter(value);
    invalidate?.();
    void browser.storage.local.set({ laterOnFilter: state.filter, laterOnFilterChosen: true }).catch(() => {});
  }
  function selectProject(id: string): void {
    if (!alive || !projects.value.some(project => project.id === id)) return;
    state.project = id;
    invalidate?.();
    void browser.storage.local.set({ laterOnActiveProject: id }).catch(() => {});
  }
  function dispose(): void { alive = false; clearTimeout(searchTimer); invalidate = undefined; }
  return { state, search, collection, visible, projects, update, connect, setSearch, setFilter, selectProject, dispose };
}
export type SidepanelControls = ReturnType<typeof useSidepanelControls>;
