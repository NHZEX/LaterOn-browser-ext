import { nextTick } from "vue";
import type { CollectionAction, CollectionSuccess, CommandFields } from "../storage/contracts";
import type { LibraryDialog } from "../library/page-adapters";
import type { SidepanelControls } from "./useSidepanelControls";

export interface PanelCommandBoundary {
  readonly accept: (response: CollectionSuccess) => void;
  readonly customSort: () => void;
  readonly setCurrent: (id: string) => void;
}

export function usePanelCommands(controls: SidepanelControls) {
  let boundary: PanelCommandBoundary | null = null;
  let alive = true;
  let dialogLoad: Promise<LibraryDialog> | undefined;
  let dialogPending = false;
  const active = new Set<string>();
  const t = (key: string): string => globalThis.LaterOnI18n?.t(key) ?? key;
  function notify(key: string): void {
    const status = document.querySelector("#status");
    if (alive && status) status.textContent = t(key);
  }
  function bind(next: PanelCommandBoundary): void { if (alive) boundary = next; }
  async function execute<A extends CollectionAction>(action: A, fields: CommandFields<A>, beforeAccept?: () => void,
    persist?: () => Promise<void>): Promise<CollectionSuccess | null> {
    const current = boundary;
    if (!alive || !current) return null;
    try {
      const response = await globalThis.LaterOnStorage.run(action, fields);
      // 已提交操作的附属偏好也要落盘，不能因页面卸载只保存了顺序却丢掉自定义模式。
      const persisted = persist?.();
      // 卸载或边界替换后，迟到响应不能再修改本页；写入仍由共享队列完成。
      if (alive && current === boundary) {
        beforeAccept?.();
        // 自身写入不保证收到广播，必须从成功响应立即更新卡片、封面与顺序。
        current.accept(response);
      }
      await persisted;
      return alive && current === boundary ? response : null;
    } catch { if (alive && current === boundary) notify("operationFailed"); return null; }
  }
  async function restoreFocus(origin: Element | null): Promise<void> {
    await nextTick();
    if (!alive) return;
    const focused = document.activeElement;
    if (focused !== document.body && focused?.isConnected && !focused.closest("[hidden], [inert]")) return;
    const target = origin instanceof HTMLElement && origin !== document.body && origin.isConnected && !origin.closest("[hidden], [inert]")
      ? origin : document.querySelector<HTMLElement>("#searchInput");
    target?.focus({ preventScroll: true });
  }
  async function perform(key: string, operation: () => Promise<void>): Promise<void> {
    if (!alive || !boundary || active.has(key)) return;
    const origin = document.activeElement;
    active.add(key);
    try { await operation(); }
    catch { notify("operationFailed"); }
    finally { active.delete(key); await restoreFocus(origin); }
  }
  // 编辑不是首屏能力，仍按需加载脚本和样式，避免把 27KB 弹窗排入冷启动链路。
  function loadDialog(): Promise<LibraryDialog> {
    if (globalThis.LaterOnDialog) return Promise.resolve(globalThis.LaterOnDialog);
    if (dialogLoad) return dialogLoad;
    dialogLoad = new Promise<LibraryDialog>((resolve, reject) => {
      if (!document.querySelector("link[data-lateron-dialog-style]")) {
        const style = document.createElement("link");
        style.rel = "stylesheet"; style.href = "dialog.css"; style.dataset.lateronDialogStyle = "";
        document.head.append(style);
      }
      const script = document.createElement("script"); script.src = "dialog.js";
      script.onload = () => globalThis.LaterOnDialog ? resolve(globalThis.LaterOnDialog) : reject(new Error("Dialog unavailable"));
      script.onerror = () => { script.remove(); reject(new Error("Dialog load failed")); };
      document.head.append(script);
    }).catch(error => { dialogLoad = undefined; throw error; });
    return dialogLoad;
  }
  async function dialog<T>(show: (dialog: LibraryDialog) => Promise<T>, failure: string): Promise<T | null> {
    if (!alive || dialogPending) return null;
    dialogPending = true;
    try {
      const api = await loadDialog();
      if (!alive) return null;
      const pending = show(api);
      // 共享弹窗排队显示；显示前卸载也必须关闭，不能遗留浮层或执行陈旧命令。
      await nextTick();
      if (!alive) api.close();
      return await pending;
    } catch { notify(failure); return null; }
    finally { dialogPending = false; }
  }
  function dispose(): void {
    alive = false; boundary = null; active.clear();
    if (dialogPending) globalThis.LaterOnDialog?.close();
  }
  return { bind, execute, perform, restoreFocus, notify, dialog, setCurrent: (id: string) => { if (alive) boundary?.setCurrent(id); },
    customSort: () => { if (alive) boundary?.customSort(); }, current: () => alive && boundary !== null,
    find: (id: string) => controls.collection.value.items.find(item => item.id === id), dispose };
}
export type PanelCommands = ReturnType<typeof usePanelCommands>;
