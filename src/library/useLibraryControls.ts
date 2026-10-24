import { computed, reactive, shallowRef } from "vue";
import { boardGroups, collectionCards, projectNavigation } from "./shared";
import type { CardOrders, LibraryCollection } from "./shared";
import { normalizeSearch, normalizeSort } from "../collection/filter";
import type { ReadFilter, SortMode } from "../collection/filter";

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
  readonly select: () => void;
  readonly project: (id: string) => void;
  readonly createProject: () => void;
  readonly editProject: (id: string) => void;
  readonly projectMenu: (id: string, x: number, y: number) => void;
  readonly rename: (id: string) => void;
  readonly cancelRename: () => void;
  readonly commitRename: (id: string, value: string) => void;
  readonly settings: (event: MouseEvent) => void;
  readonly cardsRendered: (complete: boolean) => void;
}

export function useLibraryControls() {
  const state = reactive<ControlState>({ filter: "unread", search: "", query: "", sort: "newest", count: "", board: true, selecting: false,
    activeProject: "all", renamingId: null, renameDraft: "", empty: true, emptyTitle: "quiet", emptyHint: "quietHint", currentItemId: null });
  const collection = shallowRef<LibraryCollection>({ items: [], projects: [], covers: {} });
  const orders = shallowRef<CardOrders>({});
  const selectedIds = shallowRef<ReadonlySet<string>>(new Set());
  const cardView = computed(() => collectionCards(collection.value, state, orders.value));
  const cards = computed(() => state.board ? [] : cardView.value.visible);
  const navigation = computed(() => projectNavigation(collection.value));
  const boards = computed(() => boardGroups(collection.value, state.filter, state.activeProject === "archive"));
  const boardSummary = computed(() => ({ groups: boards.value.length,
    total: boards.value.reduce((sum, group) => sum + group.items.length, 0),
    unfinished: boards.value.reduce((sum, group) => sum + group.items.filter(item => item.status !== "done").length, 0) }));
  const unfiled = computed(() => collection.value.items.filter(item => !item.projectId).length);
  const total = computed(() => collection.value.items.filter(item => !collection.value.projects.some(project => project.id === item.projectId && project.archived)).length);
  const actions = shallowRef<ControlActions | null>(null);
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
  function select(): void { actions.value?.select(); }
  function updateCollection(value: LibraryCollection): void { collection.value = value; }
  function updateOrders(value: CardOrders): void { orders.value = value; }
  function updateSelection(value: ReadonlySet<string>): void { selectedIds.value = new Set(value); }
  function cardsRendered(complete: boolean): void { actions.value?.cardsRendered(complete); }
  function project(id: string): void { actions.value?.project(id); }
  function createProject(): void { actions.value?.createProject(); }
  function editProject(id: string): void { actions.value?.editProject(id); }
  function projectMenu(id: string, x: number, y: number): void { actions.value?.projectMenu(id, x, y); }
  function rename(id: string): void { actions.value?.rename(id); }
  function cancelRename(): void { actions.value?.cancelRename(); }
  function commitRename(id: string, value: string): void { actions.value?.commitRename(id, value); }
  function settings(event: MouseEvent): void { actions.value?.settings(event); }
  function dispose(): void { clearTimeout(searchTimer); actions.value = null; }

  return { state, collection, navigation, boards, boardSummary, unfiled, total, cards, cardView, selectedIds, updateCollection, updateOrders, updateSelection, cardsRendered, bind, setFilter, setSearch, clearSearch, setSort,
    home, select, project, createProject, editProject, projectMenu, rename, cancelRename, commitRename, settings, dispose };
}

export type LibraryControls = ReturnType<typeof useLibraryControls>;
