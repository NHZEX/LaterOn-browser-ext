import { reactive } from "vue";
import { browser } from "wxt/browser";
import { t } from "../shared/i18n";
import { isRecord } from "../storage/contracts";

export function useLibraryNotice(tabId: () => number | undefined) {
  const state = reactive({ message: "", visible: false, pill: false });
  let alive = true;
  let hideTimer: ReturnType<typeof setTimeout> | undefined, variantTimer: ReturnType<typeof setTimeout> | undefined;
  function show(message: string, duration = 1800, pill = false): void {
    if (!alive) return;
    clearTimeout(hideTimer); clearTimeout(variantTimer);
    state.message = message; state.visible = true; state.pill = pill;
    hideTimer = setTimeout(() => {
      state.visible = false;
      // 退出动画结束后再移除药丸外形，避免淡出途中跳回右下角。
      variantTimer = setTimeout(() => { state.pill = false; }, 260);
    }, duration);
  }
  const message: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (request: unknown, _sender, respond) => {
    if (!alive || !isRecord(request) || request.type !== "SHOW_LIBRARY_NOTICE") return;
    if (request.tabId != null && tabId() != null && request.tabId !== tabId()) return;
    // Alt+1 / Alt+2 无法收藏或翻译扩展页面，用本页药丸解释工具栏上的失败提示。
    show(typeof request.message === "string" && request.message || t("openRegularPage"), 3200, true);
    respond({ shown: true });
  };
  function mount(): void { browser.runtime.onMessage.addListener(message); }
  function dispose(): void {
    alive = false; clearTimeout(hideTimer); clearTimeout(variantTimer);
    browser.runtime.onMessage.removeListener?.(message);
  }
  return { state, show, mount, dispose };
}
