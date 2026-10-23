import { reactive, shallowRef } from "vue";
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
}

interface ControlActions {
  readonly filter: (value: ReadFilter) => void;
  readonly search: () => void;
  readonly sort: () => void;
  readonly home: () => void;
  readonly select: () => void;
}

export function useLibraryControls() {
  const state = reactive<ControlState>({ filter: "unread", search: "", query: "", sort: "newest", count: "", board: true, selecting: false });
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
  function dispose(): void { clearTimeout(searchTimer); actions.value = null; }

  return { state, bind, setFilter, setSearch, clearSearch, setSort, home, select, dispose };
}

export type LibraryControls = ReturnType<typeof useLibraryControls>;
