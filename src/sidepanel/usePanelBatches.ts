import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { StoredItem } from "../storage/contracts";

export function usePanelBatches(source: () => readonly StoredItem[], urgent: () => boolean) {
  const ids = shallowRef<ReadonlySet<string>>(new Set());
  const rendered = computed(() => source().filter(item => ids.value.has(item.id)));
  const complete = computed(() => rendered.value.length === source().length);
  let generation = 0;
  let scheduleVersion = 0;
  let cancelPending: (() => void) | undefined;
  let continuation: (() => void) | undefined;

  function schedule(): void {
    cancelPending?.();
    const version = ++scheduleVersion;
    const run = (): void => {
      if (version !== scheduleVersion) return;
      cancelPending = undefined;
      const next = continuation;
      continuation = undefined;
      next?.();
    };
    // 有阅读定位在等时，下一帧续画；否则利用空闲时间，避免大库占住主线程。
    if (!urgent() && typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 300 });
      cancelPending = () => window.cancelIdleCallback?.(id);
    } else if (typeof window.requestAnimationFrame === "function") {
      const id = window.requestAnimationFrame(run);
      cancelPending = () => window.cancelAnimationFrame(id);
    } else {
      const id = window.setTimeout(run, 16);
      cancelPending = () => window.clearTimeout(id);
    }
  }
  function reset(items: readonly StoredItem[]): void {
    cancelPending?.();
    scheduleVersion++;
    continuation = undefined;
    const token = ++generation;
    const retained = new Set(items.filter(item => ids.value.has(item.id)).map(item => item.id));
    function append(start: number): void {
      if (token !== generation) return;
      // 侧栏一屏通常只有 4–6 张，首批 8 张覆盖第一屏；缓存仍独立限制为 12 条。
      const end = Math.min(start + 8, items.length);
      items.slice(start, end).forEach(item => retained.add(item.id));
      ids.value = new Set(retained);
      if (end < items.length) { continuation = () => append(end); schedule(); }
    }
    append(0);
  }
  watch(source, reset, { immediate: true, flush: "sync" });
  watch(urgent, () => { if (continuation) schedule(); }, { flush: "sync" });
  onScopeDispose(() => { generation++; scheduleVersion++; cancelPending?.(); continuation = undefined; });
  return { rendered, complete };
}
