import { nextTick, onScopeDispose, shallowRef } from "vue";
import type { ShallowRef } from "vue";

export interface DialogOptions {
  readonly tone?: "danger" | "question" | "success";
  readonly title: string;
  readonly message: string;
  readonly confirmText?: string;
}
export interface DialogRequest extends DialogOptions {
  readonly kind: "confirm" | "alert";
  readonly returnFocus: HTMLElement | null;
}
export interface SettingsDialog {
  readonly state: ShallowRef<DialogRequest | null>;
  finish(confirmed: boolean): Promise<void>;
  confirm(options: DialogOptions): Promise<boolean>;
  alert(options: DialogOptions): Promise<void>;
}

export function useDialog(): SettingsDialog {
  const state = shallowRef<DialogRequest | null>(null);
  let resolve: ((confirmed: boolean) => void) | undefined;
  let queue = Promise.resolve();
  let disposed = false;
  let origin: HTMLElement | null = null;

  function show(kind: DialogRequest["kind"], options: DialogOptions): Promise<boolean> {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest('[role="dialog"]')) origin = active;
    const returnFocus = origin;
    const result = queue.then(() => disposed ? false : new Promise<boolean>(done => {
      resolve = done;
      state.value = { ...options, kind, returnFocus };
    }));
    queue = result.then(() => undefined);
    return result;
  }

  async function finish(confirmed: boolean): Promise<void> {
    const done = resolve;
    resolve = undefined;
    state.value = null;
    await nextTick();
    done?.(confirmed);
  }

  onScopeDispose(() => { disposed = true; resolve?.(false); });
  return {
    state, finish,
    confirm: (options: DialogOptions) => show("confirm", options),
    alert: async (options: DialogOptions): Promise<void> => { await show("alert", options); }
  };
}
