import { nextTick } from "vue";
import { t } from "../shared/i18n";
import { loadDialog } from "../ui/load-dialog";
import { bindStorageFeedback } from "../storage/page-feedback";
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
  let loadedDialog: LibraryDialog | undefined;
  const stopFeedback = bindStorageFeedback(loadDialog);
  let dialogPending = false;
  const active = new Set<string>();
  function notify(key: string): void {
    if (alive) controls.message.value = t(key);
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
  async function dialog<T>(show: (dialog: LibraryDialog) => Promise<T>, failure: string): Promise<T | null> {
    if (!alive || dialogPending) return null;
    dialogPending = true;
    try {
      const api = await loadDialog();
      loadedDialog = api;
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
    stopFeedback();
    loadedDialog?.dispose();
  }
  return { bind, execute, perform, restoreFocus, notify, dialog, setCurrent: (id: string) => { if (alive) boundary?.setCurrent(id); },
    customSort: () => { if (alive) boundary?.customSort(); }, current: () => alive && boundary !== null,
    find: (id: string) => controls.collection.value.items.find(item => item.id === id), dispose };
}
export type PanelCommands = ReturnType<typeof usePanelCommands>;
