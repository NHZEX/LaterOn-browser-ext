import { computed, reactive, shallowRef } from "vue";
import { boardGroups, collectionCards, projectNavigation } from "./shared";
import type { CardOrders, LibraryCollection } from "./shared";
import { normalizeSearch, normalizeSort } from "../collection/filter";
import type { ReadFilter, SortMode } from "../collection/filter";
import type { LibraryMenuAction, LibraryMenuRequest, LibraryMenuTarget } from "./menu";
import { useLibrarySelection } from "./useLibrarySelection";
import { useLibraryBulk } from "./useLibraryBulk";
import { useLibraryCommands } from "./useLibraryCommands";
import { useLibraryProjects } from "./useLibraryProjects";
import { useLibraryItems } from "./useLibraryItems";

interface ControlState {
  filter: ReadFilter;
  search: string;
  query: string;
  sort: SortMode;
  count: string;
  board: boolean;
  selecting: boolean;
  activeProject: string;
  renamingId: string | null;
  renameDraft: string;
  empty: boolean;
  emptyTitle: string;
  emptyHint: string;
  currentItemId: string | null;
}

interface ControlActions {
  readonly filter: (value: ReadFilter) => void;
  readonly search: () => void;
  readonly sort: () => void;
  readonly home: () => void;
  readonly project: (id: string) => void;
  readonly openItem: (id: string) => Promise<void>;
  readonly settings: (event: MouseEvent) => void;
  readonly cardsRendered: (complete: boolean) => void;
}

export function useLibraryControls() {
  const state = reactive<ControlState>({ filter: "unread", search: "", query: "", sort: "newest", count: "", board: true, selecting: false,
    activeProject: "all", renamingId: null, renameDraft: "", empty: true, emptyTitle: "quiet", emptyHint: "quietHint", currentItemId: null });
  const collection = shallowRef<LibraryCollection>({ items: [], projects: [], covers: {} });
  const orders = shallowRef<CardOrders>({});
  const menu = shallowRef<LibraryMenuRequest | null>(null);
  const cardView = computed(() => collectionCards(collection.value, state, orders.value));
  const cards = computed(() => state.board ? [] : cardView.value.visible);
  const selection = useLibrarySelection(state, collection, cards);
  const selectedIds = selection.ids;
  const bulk = useLibraryBulk(selection, collection, cards);
  const navigation = computed(() => projectNavigation(collection.value));
  const boards = computed(() => boardGroups(collection.value, state.filter, state.activeProject === "archive"));
  const boardSummary = computed(() => ({ groups: boards.value.length,
    total: boards.value.reduce((sum, group) => sum + group.items.length, 0),
    unfinished: boards.value.reduce((sum, group) => sum + group.items.filter(item => item.status !== "done").length, 0) }));
  const unfiled = computed(() => collection.value.items.filter(item => !item.projectId).length);
  const total = computed(() => collection.value.items.filter(item => !collection.value.projects.some(project => project.id === item.projectId && project.archived)).length);
  const actions = shallowRef<ControlActions | null>(null);
  const commands = useLibraryCommands(collection);
  const projects = useLibraryProjects(state, commands, closeMenu);
  const items = useLibraryItems(commands, projects.createFromPicker, () => { clearSearch(); actions.value?.search(); });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function bind(next: ControlActions): void { actions.value = next; }
  function setFilter(value: ReadFilter): void { actions.value?.filter(value); }
  function setSearch(value: string): void {
    state.search = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = normalizeSearch(value); actions.value?.search(); }, 120);
  }
  function clearSearch(): void {
    clearTimeout(searchTimer);
    state.search = "";
    state.query = "";
  }
  function setSort(value: string): void {
    state.sort = normalizeSort(value);
    actions.value?.sort();
  }
  function home(): void { actions.value?.home(); }
  function select(): void { selection.set(!state.selecting); }
  function updateCollection(value: LibraryCollection): void { collection.value = value; }
  function updateOrders(value: CardOrders): void { orders.value = value; }
  function cardsRendered(complete: boolean): void { actions.value?.cardsRendered(complete); }
  function project(id: string): void { actions.value?.project(id); }
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
        if (action === "open") await actions.value?.openItem(target.id);
        else if (action === "edit") await items.edit(target.id);
        else if (action === "delete") await items.remove(target.id);
        else if (action === "select") selection.item(target.id, !selectedIds.value.has(target.id));
      }
    } catch { commands.toast("operationFailed"); }
  }
  function rename(id: string): void { projects.rename(id); }
  function cancelRename(): void { projects.cancelRename(); }
  function commitRename(id: string, value: string): void { void projects.commitRename(id, value); }
  function settings(event: MouseEvent): void { actions.value?.settings(event); }
  function dispose(): void { clearTimeout(searchTimer); closeMenu(); commands.dispose(); projects.dispose(); items.dispose(); bulk.dispose(); selection.dispose(); actions.value = null; }

  return { state, collection, navigation, boards, boardSummary, unfiled, total, cards, cardView, selectedIds, selection, bulk, commands, projects, items, updateCollection, updateOrders, cardsRendered, bind, setFilter, setSearch, clearSearch, setSort,
    home, select, project, createProject, editProject, menu, projectMenu, itemMenu, closeMenu, menuAction, rename, cancelRename, commitRename, settings, dispose };
}

export type LibraryControls = ReturnType<typeof useLibraryControls>;
