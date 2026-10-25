import { insertionIndex, previewOffsets } from "./shared";
import type { DragLayout } from "./shared";

interface GridReorderOptions {
  readonly container: HTMLElement;
  readonly selector: string;
  readonly idAttr: "id" | "project";
  readonly hotspot?: number;
  readonly canStart: () => boolean;
  readonly start: () => void;
  readonly commit: (id: string, beforeId: string | null) => Promise<void>;
}

// Vue 管节点，拖动只改变临时样式；布局重排会让下一次落点判定来回跳动。
export function mountGridReorder(options: GridReorderOptions) {
  const { container, selector, idAttr } = options;
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  let session: { readonly id: string; readonly elements: readonly HTMLElement[]; readonly layout: DragLayout; slot: number | null } | null = null;
  let preview: HTMLElement | null = null;
  let home: HTMLElement | null = null;
  let frame: number | undefined;

  function cancel(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    // 先清预览再清会话；Esc / 拖到别处没有 drop，也必须回收变换和原位框。
    session?.elements.forEach(element => { element.style.transform = ""; element.classList.remove("dragging"); });
    session = null;
    preview?.remove(); preview = null;
    home?.remove(); home = null;
    container.classList.remove("is-reordering");
  }
  function indexAt(event: DragEvent): number {
    return session ? insertionIndex(session.layout, session.id, session.slot,
      (Number.isFinite(event.clientX) ? event.clientX : 0) + window.scrollX,
      (Number.isFinite(event.clientY) ? event.clientY : 0) + window.scrollY) : 0;
  }
  function start(event: DragEvent): void {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>(selector);
    if (!element) return;
    if (!options.canStart()) { event.preventDefault(); return; }
    options.start();
    // 按按钮或下拉是要操作控件，不是拖整块图板 / 卡片。
    if (event.target.closest("button, select")) { event.preventDefault(); return; }
    const id = element.dataset[idAttr];
    if (!id) return;
    cancel();
    const bounds = element.getBoundingClientRect();
    preview = element.cloneNode(true) as HTMLElement;
    preview.removeAttribute("draggable");
    preview.classList.remove("dragging");
    preview.classList.add("drag-preview");
    preview.style.width = `${bounds.width}px`; preview.style.height = `${bounds.height}px`;
    document.body.append(preview);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      // 卡片热点靠左，左缘碰到项目行时真实指针也进入放置区；纵向仍保留抓取点。
      const x = Math.max(0, Math.min(bounds.width, options.hotspot ?? event.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
      event.dataTransfer.setDragImage?.(preview, x, y);
    }
    // 在 setDragImage 后、添加 dragging 前拍快照，避免拖动态影响尺寸。
    const elements = [...container.querySelectorAll<HTMLElement>(selector)];
    const layout: DragLayout = { ids: elements.map(element => element.dataset[idAttr] ?? ""), rects: elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left + window.scrollX, right: rect.right + window.scrollX,
        top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, width: rect.width, height: rect.height };
    }) };
    const current = { id, elements, layout, slot: null };
    session = current;
    const rect = layout.rects[layout.ids.indexOf(id)];
    if (rect) {
      // 原位框绝对定位，不占格子；从文档坐标换回相对容器的坐标。
      const box = container.getBoundingClientRect();
      home = document.createElement("div"); home.className = "drag-home-frame"; home.setAttribute("aria-hidden", "true");
      Object.assign(home.style, { width: `${rect.width}px`, height: `${rect.height}px`,
        left: `${rect.left - window.scrollX - box.left}px`, top: `${rect.top - window.scrollY - box.top}px` });
      container.append(home);
    }
    container.classList.add("is-reordering");
    frame = requestAnimationFrame(() => { frame = undefined; if (session === current) element.classList.add("dragging"); });
  }
  function over(event: DragEvent): void {
    if (!session) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const slot = indexAt(event);
    if (slot === session.slot) return;
    session.slot = slot;
    const offsets = previewOffsets(session.layout, session.id, slot);
    session.elements.forEach((element, index) => {
      const offset = offsets[index];
      if (offset) element.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
    });
  }
  function drop(event: DragEvent): void {
    if (!session) return;
    event.preventDefault();
    // 使用最后算好的落点；并在 await / dragend 清理前固定 ID 和锚点。
    const { id, layout } = session;
    const slot = session.slot ?? indexAt(event);
    const beforeId = layout.ids.filter(value => value !== id)[slot] ?? null;
    void options.commit(id, beforeId).finally(cancel);
  }
  container.addEventListener("dragstart", start, listen);
  container.addEventListener("dragover", over, listen);
  container.addEventListener("drop", drop, listen);
  container.addEventListener("dragend", cancel, listen);
  function dispose(): void { controller.abort(); cancel(); container.classList.remove("no-transition"); }
  return { cancel, dispose };
}
