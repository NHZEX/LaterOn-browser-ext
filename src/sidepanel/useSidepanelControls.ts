import { computed, nextTick, reactive, shallowRef } from "vue";
import { browser } from "wxt/browser";
import { normalizeFilter, normalizeSearch, type ReadFilter } from "../collection/filter";
import { panelProjects, visiblePanelItems, type PanelCollection, type PanelScope } from "./shared";

export function useSidepanelControls() {
  const state = reactive<PanelScope>({ filter: "unread", query: "", project: "unfiled" });
  const search = shallowRef("");
  const ready = shallowRef(false);
  const autoMarkRead = shallowRef(true);
  const covers = shallowRef<Readonly<Record<string, string>>>({});
  const currentId = shallowRef<string | null>(null);
  const locateRequest = shallowRef(0);
  const collection = shallowRef<PanelCollection>({ items: [], projects: [], archivedProjectIds: new Set(), orders: {}, sortMode: "newest" });
  const visible = computed(() => visiblePanelItems(collection.value, state));
  const projects = computed(() => panelProjects(collection.value));
  let invalidate: (() => void) | undefined;
  let painted: (() => void) | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  function update(snapshot: PanelCollection, images: Readonly<Record<string, string>>): void {
    if (!alive) return;
    collection.value = snapshot;
    covers.value = images;
    ready.value = true;
  }
  function connect(render: () => void, onPaint: () => void): void { invalidate = render; painted = onPaint; }
  function didPaint(): void { if (alive && ready.value) painted?.(); }
  function afterPaint(): Promise<void> { return nextTick(); }
  function locate(id: string | null): void {
    if (!alive) return;
    currentId.value = id;
    locateRequest.value++;
  }
  // 阅读定位只读 Vue 已提交的节点，不缓存节点，也不参与节点增删或排序。
  function cardElement(id: string): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>("#items .item")).find(element => element.dataset.id === id);
  }
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
  function dispose(): void { alive = false; clearTimeout(searchTimer); invalidate = undefined; painted = undefined; }
  return { state, search, collection, visible, projects, ready, autoMarkRead, covers, currentId, locateRequest,
    update, connect, didPaint, afterPaint, locate, cardElement, setSearch, setFilter, selectProject, dispose };
}
export type SidepanelControls = ReturnType<typeof useSidepanelControls>;
