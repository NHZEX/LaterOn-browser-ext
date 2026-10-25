import { computed, shallowRef, watch } from "vue";
import type { Ref } from "vue";
import type { StoredItem } from "../storage/contracts";
import type { LibraryCollection } from "./shared";

export function useLibrarySelection(state: { selecting: boolean; board: boolean }, collection: Readonly<Ref<LibraryCollection>>,
  visible: Readonly<Ref<readonly StoredItem[]>>) {
  const picked = shallowRef<ReadonlySet<string>>(new Set());
  const ids = computed(() => picked.value);
  const session = shallowRef(0);
  const active = computed(() => state.selecting);
  const allSelected = computed(() => visible.value.length > 0 && visible.value.every(item => picked.value.has(item.id)));

  function set(on: boolean): void {
    // 新会话从空选择开始，所有退出路径也清空；重复进入当前会话则保留选择。
    const next = on && !state.board;
    if (next !== state.selecting) session.value++;
    if (!next || !state.selecting) picked.value = new Set();
    state.selecting = next;
  }
  function toggle(id: string, force?: boolean): void {
    if (!state.selecting || !collection.value.items.some(item => item.id === id)) return;
    const next = new Set(picked.value);
    if (force ?? !next.has(id)) next.add(id); else next.delete(id);
    picked.value = next;
  }
  function item(id: string, on: boolean): void { if (!state.selecting) set(true); toggle(id, on); }
  function all(): void {
    if (!state.selecting) return;
    const next = new Set(picked.value);
    visible.value.forEach(item => { if (allSelected.value) next.delete(item.id); else next.add(item.id); });
    picked.value = next;
  }
  function reconcile(): void {
    const available = new Set(collection.value.items.map(item => item.id));
    picked.value = new Set([...picked.value].filter(id => available.has(id)));
  }
  function complete(ids: readonly string[]): void {
    const processed = new Set(ids);
    picked.value = new Set([...picked.value].filter(id => !processed.has(id)));
    if (!picked.value.size) set(false);
  }
  const stopCollection = watch(collection, reconcile, { flush: "sync" });
  const stopBoard = watch(() => state.board, board => { if (board) set(false); }, { flush: "sync" });
  function dispose(): void { stopCollection(); stopBoard(); set(false); }
  return { ids, session, active, allSelected, set, toggle, item, all, complete, dispose };
}

export type LibrarySelection = ReturnType<typeof useLibrarySelection>;
