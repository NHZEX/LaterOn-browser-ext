import { nextTick, watch } from "vue";
import type { ReadFilter, SortMode } from "../collection/filter";
import type { LibraryCommands } from "./useLibraryCommands";
import type { LibrarySelection } from "./useLibrarySelection";
import { mountGridReorder } from "./grid-reorder";
import { mountProjectDrag } from "./project-drag";

interface DragState {
  readonly activeProject: string;
  readonly board: boolean;
  readonly query: string;
  readonly filter: ReadFilter;
  readonly sort: SortMode;
  readonly renamingId: string | null;
}

export function useLibraryDrag(state: DragState, commands: LibraryCommands, selection: LibrarySelection, customSort: () => void) {
  const grids: ReturnType<typeof mountGridReorder>[] = [];
  let projects: ReturnType<typeof mountProjectDrag> | undefined;
  let events: AbortController | undefined;
  let pending = false;
  let disposed = false;
  function cancel(): void { grids.forEach(grid => grid.cancel()); projects?.cancel(); }
  async function commit(container: HTMLElement | null, kind: "item" | "project", id: string, beforeId: string | null): Promise<void> {
    if (pending || disposed) return;
    if (kind === "project") {
      const all = commands.collection.value.projects;
      const project = all.find(project => project.id === id);
      if (!project) return;
      const partition = all.filter(other => !!other.pinned === !!project.pinned);
      const rest = partition.filter(other => other.id !== id);
      const anchor = rest.findIndex(other => other.id === beforeId);
      if (partition.indexOf(project) === (anchor < 0 ? rest.length : anchor)) return;
    }
    pending = true;
    const name = commands.collection.value.projects.find(project => project.id === id)?.name || commands.t("unnamedProject");
    // 在第一次 await 前固定范围、目标与锚点；dragend 和外部更新都可能立即清掉拖动会话。
    const scope = state.activeProject || "all";
    const prepare = (): void => {
      // 成功后先关过渡、再清变换、最后让 Vue 提交新顺序，避免先弹回原位再跳到落点。
      container?.classList.add("no-transition"); cancel();
    };
    try {
      // 只提交范围和可见锚点；协调器合并整个范围的顺序，保留被阅读筛选隐藏的收藏位置。
      const result = kind === "item"
        ? await commands.execute("moveItem", { id, scope, beforeId }, "operationFailed", prepare)
        : await commands.execute("moveProject", { id, beforeId }, "operationFailed", prepare);
      if (!result || disposed) return;
      if (kind === "item") {
        // 一次拖动即表达自定义排序意图；保存共享设置，使侧栏与下次打开也使用同一档。
        const changed = state.sort !== "custom";
        if (changed) customSort();
        commands.toast(changed ? "customSortEnabled" : "orderSaved");
      } else {
        // 图板和侧栏共用项目顺序；后台按最新完整集合合并锚点，保留筛选隐藏的项目。
        commands.toast("movedToPosition", { name, n: (result.projects ?? []).findIndex(project => project.id === id) + 1 });
      }
      await nextTick();
      if (container && !disposed) void container.offsetHeight; // 新位置生效后再恢复过渡。
    } finally { container?.classList.remove("no-transition"); pending = false; }
  }
  async function move(id: string, projectId: string | null): Promise<void> {
    if (pending || disposed || !commands.collection.value.items.some(item => item.id === id)) return;
    pending = true;
    cancel();
    const name = projectId ? commands.collection.value.projects.find(project => project.id === projectId)?.name : commands.t("inbox");
    try {
      if (await commands.mutate("update", [id], { projectId }) && !disposed) commands.toast("movedIntoProject", { name: name || commands.t("genericProject") });
    } finally { pending = false; }
  }
  function mount(): void {
    if (disposed || events) return;
    events = new AbortController();
    const listen = { signal: events.signal };
    const grid = document.querySelector<HTMLElement>("#cardGrid");
    const board = document.querySelector<HTMLElement>("#boardGrid");
    const list = document.querySelector<HTMLElement>("#projectList");
    const sidebar = document.querySelector<HTMLElement>("#projectSidebar");
    if (grid) grids.push(mountGridReorder({ container: grid, selector: ".card", idAttr: "id", hotspot: 8,
      canStart: () => !pending, start: () => { cancel(); selection.set(false); }, commit: (id, before) => commit(grid, "item", id, before) }));
    if (board) grids.push(mountGridReorder({ container: board, selector: ".board-card", idAttr: "project",
      canStart: () => !pending, start: cancel, commit: (id, before) => commit(board, "project", id, before) }));
    if (list && sidebar) projects = mountProjectDrag({ sidebar, list, projects: () => commands.collection.value.projects,
      blocked: () => pending || !!state.renamingId, commit: (id, before) => commit(null, "project", id, before), move });
    document.addEventListener("dragend", () => projects?.clearHighlights(), listen);
    document.addEventListener("keydown", event => { if (event.key === "Escape") cancel(); }, listen);
    window.addEventListener("blur", cancel, listen);
  }
  // 数据与范围变化前回收临时节点，避免 Vue 对账时夹入旧指示线或旧动画帧。
  const stop = watch(() => [state.activeProject, state.board, state.query, state.filter, state.sort], cancel, { flush: "sync" });
  function dispose(): void { disposed = true; stop(); events?.abort(); grids.forEach(grid => grid.dispose()); projects?.dispose(); }
  return { mount, cancel, dispose };
}
