import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { StoredItem } from "../storage/contracts";

const BATCH_SIZE = 48;

/** Retain keyed cards already on screen; add new cards in cancellable idle batches. */
export function useBatchedCards(source: () => readonly StoredItem[]) {
  const renderedIds = shallowRef<ReadonlySet<string>>(new Set());
  const rendered = computed(() => source().filter(item => renderedIds.value.has(item.id)));
  const complete = computed(() => rendered.value.length === source().length);
  let generation = 0;
  let cancelPending: (() => void) | undefined;

  function cancel(): void {
    generation++;
    cancelPending?.();
    cancelPending = undefined;
  }
  function schedule(callback: () => void): void {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(callback, { timeout: 250 });
      cancelPending = () => window.cancelIdleCallback?.(handle);
    } else {
      const handle = window.setTimeout(callback, 16);
      cancelPending = () => window.clearTimeout(handle);
    }
  }
  function reset(items: readonly StoredItem[]): void {
    cancel();
    const token = generation;
    const retained = new Set(items.filter(item => renderedIds.value.has(item.id)).map(item => item.id));
    function append(start: number): void {
      if (token !== generation) return;
      cancelPending = undefined;
      const end = Math.min(start + BATCH_SIZE, items.length);
      items.slice(start, end).forEach(item => retained.add(item.id));
      renderedIds.value = new Set(retained);
      if (end < items.length) schedule(() => append(end));
    }
    append(0);
  }

  watch(source, reset, { immediate: true, flush: "sync" });
  onScopeDispose(cancel);
  return { rendered, complete };
}
