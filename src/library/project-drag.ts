import type { StoredProject } from "../storage/contracts";

const PROJECT_DRAG_TYPE = "application/x-lateron-folder";
interface ProjectDragOptions {
  readonly sidebar: HTMLElement;
  readonly list: HTMLElement;
  readonly projects: () => readonly StoredProject[];
  readonly blocked: () => boolean;
  readonly commit: (id: string, beforeId: string | null) => Promise<void>;
  readonly move: (id: string, projectId: string | null) => Promise<void>;
}

// 拖项目与拖收藏共用侧栏放置区，以自定义 MIME 区分，防止把项目当作收藏归类。
export function mountProjectDrag(options: ProjectDragOptions) {
  const { sidebar, list } = options;
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  let id: string | null = null;
  let blocked = false;
  let preview: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  function clearHighlights(): void { sidebar.querySelectorAll(".drop-target").forEach(element => element.classList.remove("drop-target")); }
  function cancel(): void {
    id = null; blocked = false;
    line?.remove(); line = null; preview?.remove(); preview = null;
    list.querySelectorAll(".is-dragging").forEach(row => row.classList.remove("is-dragging"));
    list.classList.remove("is-sorting"); clearHighlights();
  }
  // 只在原置顶分区内排序；改变置顶状态应走菜单，不能由拖动悄悄改变。
  // 下标按当前可见项目计算，隐藏的归档项目不能影响指示线落点。
  function range(): readonly [number, number] {
    const rest = options.projects().filter(project => !project.archived && project.id !== id);
    const pins = rest.filter(project => project.pinned).length;
    return options.projects().find(project => project.id === id)?.pinned ? [0, pins] : [pins, rest.length];
  }
  function over(event: DragEvent): void {
    if (!id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rows = [...list.querySelectorAll<HTMLElement>(".project-row")].filter(row => row.dataset.id !== id);
    const y = Number.isFinite(event.clientY) ? event.clientY : 0;
    const index = rows.findIndex(row => { const bounds = row.getBoundingClientRect(); return y < bounds.top + bounds.height / 2; });
    const [min, max] = range();
    const before = rows[Math.max(min, Math.min(max, index < 0 ? rows.length : index))] ?? null;
    if (!line) { line = document.createElement("div"); line.className = "folder-drop-line"; }
    // 指示线夹到合法落点，预览位置与最终结果保持一致。
    if (line.nextSibling !== before || line.parentNode !== list) list.insertBefore(line, before);
  }
  function start(event: DragEvent): void {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>(".project-row");
    if (!row) return;
    // dragstart 常以整行为 target，需记住此前 pointerdown 是否来自改名框 / 更多按钮。
    if (blocked || options.blocked()) { event.preventDefault(); return; }
    cancel(); id = row.dataset.id ?? null;
    if (!id) return;
    const transfer = event.dataTransfer;
    if (transfer) {
      transfer.effectAllowed = "move";
      try { transfer.setData(PROJECT_DRAG_TYPE, id); } catch { /* Some drag sources restrict custom data. */ }
      if (transfer.setDragImage) {
        // 原行透明底，实体化克隆让拖影清晰，保持原抓取点。
        const bounds = row.getBoundingClientRect();
        preview = row.cloneNode(true) as HTMLElement;
        preview.removeAttribute("draggable"); preview.classList.remove("is-dragging"); preview.classList.add("folder-drag-preview");
        preview.style.width = `${bounds.width || 180}px`; document.body.append(preview);
        const point = (value: number, size: number): number => Number.isFinite(value) ? Math.max(0, Math.min(size, value)) : 0;
        transfer.setDragImage(preview, point(event.clientX - bounds.left, bounds.width || 180), point(event.clientY - bounds.top, bounds.height || 36));
      }
    }
    row.classList.add("is-dragging"); list.classList.add("is-sorting");
  }
  function drop(event: DragEvent): void {
    if (!id) return;
    event.preventDefault();
    const dragged = options.projects().find(project => project.id === id);
    if (!dragged || line?.parentNode !== list) { cancel(); return; }
    const children = [...list.children];
    const index = children.slice(0, children.indexOf(line)).filter(element => element instanceof HTMLElement
      && element.classList.contains("project-row") && element.dataset.id !== id).length;
    const visible = options.projects().filter(project => !project.archived);
    const rest = visible.filter(project => project.id !== id);
    const [min, max] = range();
    const at = Math.max(min, Math.min(max, index));
    // 在 await / dragend 前捕获目标；原位或没有指示线的 drop 不写入。
    if (visible.indexOf(dragged) === at) { cancel(); return; }
    void options.commit(dragged.id, rest[at]?.id ?? null).finally(cancel);
  }
  function target(event: DragEvent): HTMLElement | null {
    if (id || Array.from(event.dataTransfer?.types ?? []).includes(PROJECT_DRAG_TYPE) || !(event.target instanceof Element)) return null;
    return event.target.closest<HTMLElement>(".project-row, .inbox-card");
  }
  list.addEventListener("pointerdown", event => {
    blocked = event.target instanceof Element && !!event.target.closest(".project-rename, .project-more");
  }, listen);
  list.addEventListener("dragstart", start, listen);
  list.addEventListener("dragend", cancel, listen);
  list.addEventListener("dragover", over, listen);
  list.addEventListener("drop", drop, listen);
  sidebar.addEventListener("dragover", event => {
    const element = target(event); if (!element) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clearHighlights(); element.classList.add("drop-target");
  }, listen);
  sidebar.addEventListener("dragleave", event => {
    const element = target(event);
    if (element && (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget))) element.classList.remove("drop-target");
  }, listen);
  sidebar.addEventListener("drop", event => {
    const element = target(event); if (!element) return;
    event.preventDefault();
    const itemId = event.dataTransfer?.getData("text/plain");
    const projectId = element.dataset.project;
    clearHighlights();
    if (itemId && projectId) void options.move(itemId, projectId === "unfiled" ? null : projectId);
  }, listen);
  function dispose(): void { controller.abort(); cancel(); }
  return { cancel, dispose, clearHighlights };
}
