import { nextTick, watch } from "vue";
import { browser } from "wxt/browser";
import { previewOffsets, type DragLayout } from "../library/shared";
import type { SidepanelControls } from "./useSidepanelControls";
import type { PanelCommands } from "./usePanelCommands";

export function usePanelDrag(controls: SidepanelControls, commands: PanelCommands) {
  let session: { readonly id: string; readonly layout: DragLayout; readonly elements: readonly HTMLElement[]; slot: number | null } | null = null;
  let preview: HTMLElement | null = null;
  let frame: number | undefined;
  let suppressedUntil = 0;
  let pending = false;
  let alive = true;
  function cancel(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    session?.elements.forEach(element => { element.style.transform = ""; element.classList.remove("dragging"); });
    if (session) suppressedUntil = Date.now() + 250;
    session = null; preview?.remove(); preview = null;
    document.querySelector("#items")?.classList.remove("is-reordering");
  }
  function start(event: DragEvent, id: string): void {
    if (!(event.target instanceof Element)) return;
    // 搜索跨项目，没有唯一排序范围；按钮和输入控件只执行自己的操作。
    if (!alive || pending || controls.state.query || event.target.closest("button, select, input, textarea")) { event.preventDefault(); return; }
    const article = event.target.closest<HTMLElement>(".item");
    const list = article?.parentElement;
    if (!article || !list) return;
    cancel();
    const elements = [...list.querySelectorAll<HTMLElement>(".item")];
    // 只在起始读取布局；过程只用 transform 预览，不挪 DOM，也不重复读取已变换位置。
    const layout: DragLayout = { ids: elements.map(element => element.dataset.id ?? ""), rects: elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left + scrollX, right: rect.right + scrollX, top: rect.top + scrollY, bottom: rect.bottom + scrollY, width: rect.width, height: rect.height };
    }) };
    const current = { id, elements, layout, slot: null };
    session = current;
    const bounds = article.getBoundingClientRect();
    preview = article.cloneNode(true) as HTMLElement;
    preview.removeAttribute("draggable"); preview.classList.remove("dragging", "is-current");
    preview.classList.add("card-drag-preview");
    preview.style.width = `${bounds.width}px`; preview.style.height = `${bounds.height}px`;
    document.body.append(preview);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.setDragImage?.(preview, Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)));
    }
    list.classList.add("is-reordering");
    frame = requestAnimationFrame(() => { frame = undefined; if (session === current) article.classList.add("dragging"); });
  }
  function indexAt(event: DragEvent): number {
    if (!session) return 0;
    const { layout, id, slot } = session;
    const from = layout.ids.indexOf(id);
    const x = (Number.isFinite(event.clientX) ? event.clientX : 0) + scrollX;
    const y = (Number.isFinite(event.clientY) ? event.clientY : 0) + scrollY;
    const grid = layout.rects.some((rect, index) => layout.rects.some((other, otherIndex) => otherIndex !== index && Math.abs(other.top - rect.top) < 2));
    const hit = layout.rects.findIndex((rect, index) => index !== from && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    if (hit < 0) return slot ?? (layout.rects.length && y < layout.rects[0]!.top ? 0 : layout.ids.length - 1);
    const rect = layout.rects[hit]!;
    // 窄侧栏按上下半区判断；拖宽成网格后按左右半区判断。
    const after = grid ? x >= rect.left + rect.width / 2 : y >= rect.top + rect.height / 2;
    return (hit < from ? hit : hit - 1) + Number(after);
  }
  function over(event: DragEvent): void {
    if (!session) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const slot = indexAt(event);
    if (session.slot === slot) return;
    session.slot = slot;
    previewOffsets(session.layout, session.id, slot).forEach((offset, index) => {
      const element = session?.elements[index];
      if (element) element.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
    });
  }
  async function drop(event: DragEvent): Promise<void> {
    if (!session || pending) return;
    event.preventDefault();
    // 在 await / dragend 前固定目标、范围和锚点。协调器合并完整顺序，保留筛选隐藏项。
    const { id, layout } = session;
    const beforeId = layout.ids.filter(value => value !== id)[session.slot ?? indexAt(event)] ?? null;
    const scope = controls.state.project || "unfiled";
    const wasCustom = controls.collection.value.sortMode === "custom";
    pending = true;
    const list = document.querySelector("#items");
    try {
      const result = await commands.execute("moveItem", { id, scope, beforeId }, () => {
        list?.classList.add("no-transition"); cancel(); commands.customSort();
      }, async () => {
        const stored = await browser.storage.local.get<{ laterOnSettings?: Record<string, unknown> }>("laterOnSettings");
        await browser.storage.local.set({ laterOnSettings: { ...stored.laterOnSettings, defaultSort: "custom" } });
      });
      if (!alive || !result) return;
      commands.notify(wasCustom ? "orderSaved" : "customSortEnabled");
      await nextTick();
      if (alive && list instanceof HTMLElement) void list.offsetHeight;
    } catch { commands.notify("operationFailed"); }
    finally { cancel(); list?.classList.remove("no-transition"); pending = false; }
  }
  // 外部集合、排序或范围变化前清掉瞬态节点，避免 Vue 对账及过期帧留下拖影。
  const stop = watch(() => [controls.collection.value, controls.state.project, controls.state.filter, controls.state.query], cancel, { flush: "sync" });
  function escape(event: KeyboardEvent): void { if (event.key === "Escape") cancel(); }
  function mount(): void { document.addEventListener("keydown", escape); window.addEventListener("blur", cancel); }
  function dispose(): void { alive = false; stop(); cancel(); document.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel); }
  return { start, over, drop, cancel, mount, dispose, suppressClick: () => Date.now() < suppressedUntil };
}
export type PanelDrag = ReturnType<typeof usePanelDrag>;
