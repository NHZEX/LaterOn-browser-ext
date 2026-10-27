import { nextTick, shallowRef } from "vue";
import type { Ref } from "vue";
import type { StorageClient } from "../storage/client";
import type { CollectionAction, CollectionSuccess, CommandFields, ItemChanges } from "../storage/contracts";
import type { Translate } from "../shared/i18n";
import type { LibraryCollection } from "./shared";

import type { PromptOptions, PromptValues } from "../ui/types";
export type { PromptOptions, PromptValues } from "../ui/types";
interface ConfirmOptions { readonly tone: "danger"; readonly title: string; readonly message: string; readonly confirmText: string }
export interface ItemPickerRequest {
  readonly anchor: HTMLElement;
  readonly selected: string;
  readonly onCreateProject: (name: string) => Promise<{ readonly id: string; readonly name?: string } | null>;
  readonly onPick: (id: string | null, name: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
}
interface CommandEffects {
  readonly storage: Pick<StorageClient, "run">;
  readonly accept: (response: CollectionSuccess) => void;
  readonly translate: Translate;
  readonly toast: (message: string) => void;
  readonly navigate: (id: string) => void;
  readonly prompt: (options: PromptOptions) => Promise<{ readonly ok: boolean; readonly values?: PromptValues | null } | false>;
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly closeDialog: () => void;
  readonly pick: (request: ItemPickerRequest) => { readonly close: () => void };
}

export function useLibraryCommands(collection: Readonly<Ref<LibraryCollection>>) {
  const effects = shallowRef<CommandEffects | null>(null);
  const active = new Set<string>();
  let openDialogs = 0;
  const current = (): boolean => effects.value !== null;
  const t: Translate = (key, values) => effects.value?.translate(key, values) ?? key;
  function bind(next: CommandEffects): void { effects.value = next; }
  function toast(key: string, values?: Parameters<Translate>[1]): void { effects.value?.toast(t(key, values)); }
  function navigate(id: string): void { effects.value?.navigate(id); }
  async function execute<A extends CollectionAction>(action: A, fields: CommandFields<A>, failure = "operationFailed", beforeAccept?: () => void): Promise<CollectionSuccess | null> {
    const boundary = effects.value;
    if (!boundary) return null;
    try {
      const result = await boundary.storage.run(action, fields);
      // 卸载或适配器替换后，迟到响应不能再更新本页；成功仍由共享队列负责持久化。
      if (effects.value !== boundary) return null;
      // 排序需先收起瞬态预览，再替换集合供 Vue 对账；其它命令无需此钩子。
      beforeAccept?.();
      // 自身写入不保证收到 storage.onChanged，必须立即用成功响应更新页面。
      boundary.accept(result);
      return result;
    } catch { if (effects.value === boundary) toast(failure); return null; }
  }
  function mutate(operation: "update" | "delete", ids: readonly string[], patch?: ItemChanges): Promise<CollectionSuccess | null> {
    return execute("mutateItems", { operation, ids, patch });
  }
  async function restoreFocus(origin: Element | null, fallback = "#searchInput"): Promise<void> {
    await nextTick();
    if (!current()) return;
    const focused = document.activeElement;
    // 等 Vue 提交节点变化后再恢复焦点，避免抢走已交给其它控件的焦点。
    if (focused !== document.body && focused?.isConnected && !focused.closest(".lod-root[hidden]")) return;
    const target = origin instanceof HTMLElement && origin !== document.body && origin.isConnected && !origin.closest("[hidden], [inert]")
      ? origin : document.querySelector<HTMLElement>(fallback);
    target?.focus({ preventScroll: true });
  }
  async function perform(key: string, operation: () => Promise<void>, failure = "operationFailed"): Promise<void> {
    // 同一目标在弹窗及写入期间只执行一次，失败或取消后释放，允许重试。
    if (!current() || active.has(key)) return;
    const origin = document.activeElement;
    active.add(key);
    try { await operation(); }
    catch { if (current()) toast(failure); }
    finally { active.delete(key); await restoreFocus(origin); }
  }
  async function prompt(options: PromptOptions) {
    const boundary = effects.value;
    if (openDialogs || !boundary) return null;
    openDialogs++;
    try {
      const pending = boundary.prompt(options);
      // 共享弹窗排队后才显示；若这期间卸载，等显示微任务执行后再关闭，防止遗留弹窗。
      await nextTick();
      if (effects.value !== boundary) boundary.closeDialog();
      return await pending || null;
    } finally { openDialogs--; }
  }
  async function confirm(options: ConfirmOptions): Promise<boolean> {
    const boundary = effects.value;
    if (openDialogs || !boundary) return false;
    openDialogs++;
    try {
      const pending = boundary.confirm(options);
      // 确认框与编辑弹窗共用异步显示队列，同样处理显示前卸载。
      await nextTick();
      if (effects.value !== boundary) boundary.closeDialog();
      return await pending;
    } finally { openDialogs--; }
  }
  function pick(request: ItemPickerRequest) { return effects.value?.pick(request); }
  function dispose(): void { if (openDialogs) effects.value?.closeDialog(); effects.value = null; active.clear(); }
  return { collection, current, t, bind, toast, navigate, execute, mutate, perform, prompt, confirm, pick, restoreFocus, dispose };
}

export type LibraryCommands = ReturnType<typeof useLibraryCommands>;
