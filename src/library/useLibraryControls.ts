import { shallowRef, watch } from "vue";
import type { LibraryMenuAction, LibraryMenuRequest, LibraryMenuTarget } from "./menu";
import { useLibrarySelection } from "./useLibrarySelection";
import { useLibraryBulk } from "./useLibraryBulk";
import { useLibraryCommands } from "./useLibraryCommands";
import { useLibraryProjects } from "./useLibraryProjects";
import { useLibraryItems } from "./useLibraryItems";
import { useLibraryDrag } from "./useLibraryDrag";
import { useSidebarWidth } from "./useSidebarWidth";
import { useLibraryView } from "./useLibraryView";
import { useLibraryNavigation } from "./useLibraryNavigation";
import { useLibraryStorage } from "./useLibraryStorage";
import { useLibraryReader } from "./useLibraryReader";
import { useLibraryNotice } from "./useLibraryNotice";
import { useCurrentReading } from "./useCurrentReading";
import { bindPageAdapters, bindSidebar, openLibrarySettings } from "./page-adapters";
import type { LibrarySnapshot } from "./page";

export function useLibraryControls() {
  const view = useLibraryView();
  const { state, collection, orders, cards } = view;
  const menu = shallowRef<LibraryMenuRequest | null>(null);
  const selection = useLibrarySelection(state, collection, cards);
  const selectedIds = selection.ids;
  const bulk = useLibraryBulk(selection, collection, cards);
  const pageNavigation = useLibraryNavigation(view);
  const commands = useLibraryCommands(collection);
  const drag = useLibraryDrag(state, commands, selection, () => pageNavigation.setSort("custom"));
  const sidebar = useSidebarWidth(commands.t);
  const projects = useLibraryProjects(state, commands, closeMenu);
  const items = useLibraryItems(commands, projects.createFromPicker, pageNavigation.clearSearch);
  const reader = useLibraryReader(view, items, message => notice.show(message));
  const notice = useLibraryNotice(reader.tabId);
  const currentReading = useCurrentReading(state);
  const storage = useLibraryStorage(view, applyScope, () => commands.toast("operationFailed"));
  const stopCollection = watch([collection, orders], () => drag.cancel(), { flush: "sync" });
  let alive = true;
  let adapters: ReturnType<typeof bindPageAdapters> | undefined;

  function applyScope(snapshot: LibrarySnapshot, initial: boolean): void {
    if (initial) {
      pageNavigation.initialize(snapshot);
      const params = new URLSearchParams(location.search);
      // 侧栏 focus 仅接受共享当前文章，陈旧链接不能错误地定位另一篇。
      const id = snapshot.laterOnCurrentItem || null;
      currentReading.update(id, params.get("from") === "sidepanel" && params.get("focus") === id);
      bindSidebar({ sidebar }, snapshot);
    } else {
      pageNavigation.changed(snapshot);
      if ("laterOnCurrentItem" in snapshot) currentReading.update(snapshot.laterOnCurrentItem || null, true);
    }
  }
  function select(): void { selection.set(!state.selecting); }
  function project(id: string): void { pageNavigation.project(id); }
  function createProject(): void { void projects.create(); }
  function editProject(id: string): void { void projects.edit(id); }
  function projectMenu(id: string, x: number, y: number, trigger: HTMLElement | null = null): void { menu.value = { kind: "project", id, x, y, trigger }; }
  function itemMenu(id: string, x: number, y: number, trigger: HTMLElement | null = null): void { menu.value = { kind: "item", id, x, y, trigger }; }
  function closeMenu(): void { menu.value = null; }
  async function menuAction(target: LibraryMenuTarget, action: LibraryMenuAction): Promise<void> {
    try {
      if (target.kind === "project") {
        if (action === "pin") await projects.pin(target.id);
        else if (action === "rename") projects.rename(target.id);
        else if (action === "edit") await projects.edit(target.id);
        else if (action === "archive") await projects.archive(target.id);
        else if (action === "delete") await projects.remove(target.id);
      } else {
        if (action === "open") await reader.newTab(target.id);
        else if (action === "edit") await items.edit(target.id);
        else if (action === "delete") await items.remove(target.id);
        else if (action === "select") selection.item(target.id, !selectedIds.value.has(target.id));
      }
    } catch { commands.toast("operationFailed"); }
  }
  function rename(id: string): void { projects.rename(id); }
  function cancelRename(): void { projects.cancelRename(); }
  function commitRename(id: string, value: string): void { void projects.commitRename(id, value); }
  function settings(event: MouseEvent): void { void openLibrarySettings(event, () => alive).catch(() => commands.toast("operationFailed")); }
  function openItem(id: string, event: MouseEvent): void { void reader.open(id, event).catch(() => commands.toast("operationFailed")); }
  function mount(): void {
    if (!alive || adapters) return;
    adapters = bindPageAdapters(controls);
    adapters.mount(); pageNavigation.mount(); notice.mount(); drag.mount();
    void reader.mount(); void storage.mount();
  }
  function dispose(): void {
    alive = false; adapters?.dispose(); storage.dispose(); reader.dispose(); notice.dispose(); currentReading.dispose(); pageNavigation.dispose();
    stopCollection(); closeMenu(); drag.dispose(); sidebar.dispose(); commands.dispose(); projects.dispose(); items.dispose(); bulk.dispose(); selection.dispose();
  }
  const controls = { ...view, settings, selectedIds, selection, bulk, commands, projects, items, drag, sidebar, storage, reader, notice,
    cardsRendered: currentReading.cardsRendered, setFilter: pageNavigation.setFilter, setSearch: pageNavigation.setSearch, clearSearch: pageNavigation.clearSearch, setSort: pageNavigation.setSort,
    home: pageNavigation.home, select, project, createProject, editProject, menu, projectMenu, itemMenu, closeMenu, menuAction, rename, cancelRename, commitRename, openItem, mount, dispose };
  return controls;
}

export type LibraryControls = ReturnType<typeof useLibraryControls>;
