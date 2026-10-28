import { ref, watch } from "vue";
import { browser } from "wxt/browser";
import { normalizeFilter, normalizeSearch, normalizeSort } from "../collection/filter";
import { ACTIVE } from "../storage/contracts";
import { t } from "../shared/i18n";
import { libraryProject } from "./shared";
import { FILTER, FILTER_CHOSEN, SETTINGS } from "./page";
import type { LibrarySnapshot } from "./page";
import type { LibraryView } from "./useLibraryView";

export function useLibraryNavigation(view: LibraryView) {
  const { state, collection } = view;
  // 首页使用品牌 slogan；明确进入导航范围后，标签页才使用范围名称。
  const homeTitle = ref(true);
  let alive = true;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function title(): void {
    if (!alive) return;
    const key = state.activeProject === "unfiled" ? "inbox" : state.activeProject === "archive" ? "archive" : "allProjectsOverview";
    const name = homeTitle.value ? t("slogan") : collection.value.projects.find(project => project.id === state.activeProject)?.name || t(key);
    document.title = `StaySide - ${name}`;
  }
  const stopTitle = watch([() => state.activeProject, homeTitle, () => collection.value.projects], title, { flush: "sync" });
  function initialize(snapshot: LibrarySnapshot): void {
    const params = new URLSearchParams(location.search), sidepanel = params.get("from") === "sidepanel";
    // 普通入口回到全部项目；只有侧栏展开才恢复项目现场。
    state.activeProject = sidepanel ? libraryProject(params.get("project") || snapshot[ACTIVE], collection.value.projects) : "all";
    homeTitle.value = !sidepanel;
    state.sort = normalizeSort(snapshot[SETTINGS]?.defaultSort);
    // 旧版首页写过 all，但没有明确选择标记时仍以未读作为初始偏好。
    state.filter = sidepanel ? normalizeFilter(params.get("filter") || snapshot[FILTER]) : snapshot[FILTER_CHOSEN] ? normalizeFilter(snapshot[FILTER]) : "unread";
    const query = (params.get("q") || "").trim();
    if (query) {
      state.search = query; state.query = normalizeSearch(query); homeTitle.value = false;
      // lo 关键词临时搜索全部阅读状态，不改写日常筛选偏好。
      if (params.get("from") === "omnibox") state.filter = "all";
    }
    title();
  }
  function changed(snapshot: LibrarySnapshot): void {
    if (ACTIVE in snapshot) {
      const next = libraryProject(snapshot[ACTIVE], collection.value.projects);
      // 自身存储回声不能把首页 slogan 改成范围标题。
      if (next !== state.activeProject) { state.activeProject = next; homeTitle.value = false; }
    }
    // 阅读筛选和排序由侧栏与全屏共享；本地先更新，广播只接管真正变化。
    if (FILTER in snapshot) state.filter = normalizeFilter(snapshot[FILTER]);
    if (snapshot[SETTINGS]?.defaultSort) state.sort = normalizeSort(snapshot[SETTINGS]?.defaultSort);
  }
  function setFilter(value: string): void {
    const next = normalizeFilter(value);
    if (!alive || next === state.filter) return;
    state.filter = next;
    void browser.storage.local.set({ [FILTER]: next, [FILTER_CHOSEN]: true }).catch(() => {}); // 写失败仍保留本地筛选。
  }
  function setSearch(value: string): void {
    if (!alive) return;
    state.search = value; clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (alive) state.query = normalizeSearch(value); }, 120);
  }
  // 搜索是临时查看状态，切换项目或移动收藏后清除，避免旧词继续过滤新页面。
  function clearSearch(): void { clearTimeout(searchTimer); state.search = ""; state.query = ""; }
  async function saveSort(): Promise<void> {
    try {
      const stored = await browser.storage.local.get<LibrarySnapshot>(SETTINGS);
      if (!alive) return;
      const settings = stored[SETTINGS] ?? {};
      if (settings.defaultSort !== state.sort) await browser.storage.local.set({ [SETTINGS]: { ...settings, defaultSort: state.sort } });
    } catch { /* 本次会话的排序照常可用。 */ }
  }
  function setSort(value: string): void { if (alive) { state.sort = normalizeSort(value); void saveSort(); } }
  function project(id: string, asHome = false): void {
    if (!alive) return;
    clearSearch(); state.activeProject = libraryProject(id, collection.value.projects); homeTitle.value = asHome;
    void browser.storage.local.set({ [ACTIVE]: state.activeProject }).catch(() => {});
  }
  // 品牌标识是统一回首页入口：复位项目、未读筛选、搜索与滚动位置。
  function home(): void { if (alive) { setFilter("unread"); project("all", true); window.scrollTo({ top: 0, behavior: "smooth" }); } }
  function mount(): void { window.addEventListener("lateron-language-change", title); }
  function dispose(): void { alive = false; clearTimeout(searchTimer); stopTitle(); window.removeEventListener("lateron-language-change", title); }
  return { initialize, changed, setFilter, setSearch, clearSearch, setSort, project, home, mount, dispose };
}
