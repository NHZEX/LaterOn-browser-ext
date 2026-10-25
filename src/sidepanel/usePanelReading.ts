import { nextTick, onScopeDispose, shallowRef, watch } from "vue";
import { browser } from "wxt/browser";
import type { SidepanelControls } from "./useSidepanelControls";

export function usePanelReading(controls: SidepanelControls, complete: () => boolean) {
  const pending = shallowRef(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelFrame: (() => void) | undefined;
  let alive = true;

  function cancel(): void {
    clearTimeout(timer);
    cancelFrame?.();
    cancelFrame = undefined;
  }
  // 窄栏兜底 58px，拖宽后实际可能为 64px；实时量吸顶栏，再留 10px 边距。
  function visibleTop(): number {
    const bottom = document.querySelector("header")?.getBoundingClientRect().bottom;
    return (bottom && Number.isFinite(bottom) && bottom > 0 ? bottom : 58) + 10;
  }
  function inView(article: HTMLElement): boolean {
    const rect = article.getBoundingClientRect();
    if (!window.innerHeight || !rect.height) return true;
    return rect.top >= visibleTop() - 1 && rect.bottom <= window.innerHeight + 1;
  }
  function diagnose(record: { found: boolean; inView?: boolean; scrolled?: boolean; attempts: number; scrollY?: number }): void {
    void browser.storage.local.set({ laterOnLocateDiag: {
      at: Date.now(), itemId: controls.currentId.value, viewport: window.innerHeight || 0, ...record
    } }).catch(() => {});
  }
  // scrollIntoView 在侧栏展开时可能丢失或滚偏，使用能测量和复查的 window.scrollTo。
  function center(article: HTMLElement, smooth: boolean): void {
    const rect = article.getBoundingClientRect();
    const viewport = window.innerHeight;
    if (!viewport || !rect.height) return;
    const current = window.scrollY || window.pageYOffset || 0;
    const inset = visibleTop();
    const target = current + rect.top - inset - (Math.max(0, viewport - inset) - rect.height) / 2;
    const max = (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - viewport;
    const top = Math.max(0, max > 0 ? Math.min(target, max) : target);
    if (Math.abs(top - current) < 2) return;
    try { window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" }); }
    catch { window.scrollTo(0, top); }
  }
  function locate(attempt = 0): void {
    // 卡片即便已出现，后批插入仍可能改变位置，必须等整张列表提交后再量坐标。
    if (!alive || !pending.value || !complete() || !controls.currentId.value) return;
    const article = controls.cardElement(controls.currentId.value);
    if (!article) { pending.value = false; diagnose({ found: false, attempts: attempt }); return; }
    clearTimeout(timer);
    if (inView(article)) {
      if (attempt === 0) {
        // 宽度媒体查询或封面完成布局后可能再挤出视野，延迟复查一次。
        timer = setTimeout(() => {
          if (!pending.value) return;
          const target = controls.currentId.value ? controls.cardElement(controls.currentId.value) : undefined;
          if (target && !inView(target)) { locate(1); return; }
          pending.value = false;
          diagnose({ found: !!target, inView: !!target, scrolled: false, attempts: 0 });
        }, 320);
      } else { pending.value = false; diagnose({ found: true, inView: true, scrolled: true, attempts: attempt }); }
      return;
    }
    center(article, attempt === 0);
    // 展开瞬间浏览器可能丢掉平滑滚动；最多三次，后两次瞬时补正。
    timer = setTimeout(() => {
      if (!pending.value) return;
      const target = controls.currentId.value ? controls.cardElement(controls.currentId.value) : undefined;
      if (!target) { pending.value = false; diagnose({ found: false, attempts: attempt + 1 }); return; }
      if (!inView(target) && attempt < 2) { locate(attempt + 1); return; }
      pending.value = false;
      diagnose({ found: true, inView: inView(target), scrolled: true, attempts: attempt + 1, scrollY: Math.round(window.scrollY || 0) });
    }, 420);
  }
  function committed(): void {
    if (!alive || !pending.value || !complete()) return;
    cancelFrame?.();
    const request = controls.locateRequest.value;
    const run = (): void => {
      if (request !== controls.locateRequest.value) return;
      cancelFrame = undefined;
      locate();
    };
    // 包一层，避免把 rAF 时间戳当成 attempt，导致首滚失去平滑和重试。
    if (typeof window.requestAnimationFrame === "function") {
      const id = window.requestAnimationFrame(run);
      cancelFrame = () => window.cancelAnimationFrame(id);
    } else {
      const id = window.setTimeout(run, 16);
      cancelFrame = () => window.clearTimeout(id);
    }
  }
  watch(controls.locateRequest, () => {
    cancel();
    pending.value = !!controls.currentId.value;
    void nextTick().then(committed);
  }, { flush: "sync" });
  onScopeDispose(() => { alive = false; pending.value = false; cancel(); });
  return { pending, committed };
}
