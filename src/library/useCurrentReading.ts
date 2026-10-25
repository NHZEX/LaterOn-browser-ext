import { nextTick } from "vue";

export function useCurrentReading(state: { currentItemId: string | null }) {
  let alive = true, pending: string | null = null;
  let frame: number | undefined;
  function cardsRendered(complete: boolean): void {
    if (!alive || !pending) return;
    const id = pending;
    // 不把存储中的 id 拼进选择器，兼容引号等任意字符。
    const card = [...document.querySelectorAll<HTMLElement>("#cardGrid .card")].find(card => card.dataset.id === id);
    if (card) {
      pending = null;
      if (frame !== undefined) cancelAnimationFrame(frame);
      // Vue 每批 DOM 提交后才通知定位；卸载或目标变化后过期帧失效。
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (alive && state.currentItemId === id && card.isConnected) card.scrollIntoView?.({ block: "center", behavior: "smooth" });
      });
    } else if (complete) pending = null; // 筛选外的目标不强行切换范围，批次结束便停止寻找。
  }
  function update(id: string | null, locate: boolean): void {
    state.currentItemId = id;
    pending = locate ? id : null;
    if (locate) void nextTick(() => cardsRendered(false));
  }
  function dispose(): void { alive = false; pending = null; if (frame !== undefined) cancelAnimationFrame(frame); }
  return { update, cardsRendered, dispose };
}
