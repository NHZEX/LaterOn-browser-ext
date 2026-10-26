import { shallowRef } from "vue";
import { browser } from "wxt/browser";
import { t } from "../shared/i18n";
import type { SidepanelControls } from "./useSidepanelControls";

export function usePanelBrowser(controls: SidepanelControls) {
  const opening = shallowRef(false);
  let alive = true, ready = false;
  // 完整界面的握手可能早于窗口查询；等待同一 Promise，不能提前错报窗口不匹配。
  let windowIdReady: Promise<number | undefined>;
  const ping: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, _sender, respond) => {
    if (message.type !== "PING_SIDEPANEL") return;
    void windowIdReady.then(id => { if (alive) respond({ ready: ready && id !== undefined && id === message.windowId }); });
    return true;
  };
  function mount(): void {
    windowIdReady = browser.windows.getCurrent().then(info => info.id, () => undefined);
    browser.runtime.onMessage.addListener(ping);
  }
  async function openLibrary(): Promise<void> {
    if (!alive || opening.value) return;
    opening.value = true;
    let opened = false;
    const context = { source: "sidepanel", projectId: controls.state.project, filter: controls.state.filter, focusItemId: controls.currentId.value };
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!alive) return;
      const response = await browser.runtime.sendMessage({ type: "OPEN_LIBRARY", context });
      if (!alive) return;
      if (!response?.ok || !tab?.windowId) throw new Error("Library unavailable");
      opened = true;
      await browser.sidePanel.close({ windowId: tab.windowId });
    } catch {
      if (!alive) return;
      if (opened) window.close();
      else controls.message.value = t("libraryOpenFailed");
    } finally { if (alive) opening.value = false; }
  }
  function dispose(): void { alive = false; ready = false; browser.runtime.onMessage.removeListener(ping); }
  return { opening, openLibrary, mount, markReady: () => { if (alive) ready = true; }, dispose };
}
