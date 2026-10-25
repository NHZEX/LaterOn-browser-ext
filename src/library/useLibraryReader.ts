import { browser } from "wxt/browser";
import { activate, findOpen } from "../tabs/navigation";
import { CURRENT } from "../storage/contracts";
import { t } from "../shared/i18n";
import { cardTarget } from "./shared";
import type { LibraryView } from "./useLibraryView";
import type { LibraryItems } from "./useLibraryItems";

export function useLibraryReader(view: LibraryView, items: LibraryItems, toast: (message: string) => void) {
  let alive = true, tabId: number | undefined, windowId: number | undefined;
  const waits = new Map<ReturnType<typeof setTimeout>, () => void>();
  async function mount(): Promise<void> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (alive) { tabId = tab?.id; windowId = tab?.windowId; }
  }
  // 收藏库可被拖到另一窗口，每次点击重新认准自身窗口和标签，不能只相信启动缓存。
  async function resolveWindow(): Promise<number | undefined> {
    const self = await browser.tabs.getCurrent().catch(() => null);
    if (!alive) return;
    if (self?.id && self.windowId != null) { tabId = self.id; windowId = self.windowId; return windowId; }
    const win = await browser.windows.getCurrent().catch(() => null);
    if (alive && win?.id != null) windowId = win.id;
    return windowId;
  }
  // 侧栏须在用户手势流程中尽早打开，先开侧栏再导航，避免新增异步调度丢失手势。
  async function openSidePanel(destination: number | undefined): Promise<boolean> {
    if (!alive || typeof browser.sidePanel?.open !== "function") return false;
    if (destination != null) {
      try { await browser.sidePanel.open({ windowId: destination }); return alive; } catch { /* 窗口缓存可能过期，刷新后重试。 */ }
    }
    if (!alive) return false;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (alive && tab?.windowId != null) { await browser.sidePanel.open({ windowId: tab.windowId }); return alive; }
    } catch { /* 调用方提供新标签页兜底。 */ }
    return false;
  }
  async function waitForPanel(destination: number | undefined): Promise<void> {
    const deadline = Date.now() + 1500;
    while (alive && Date.now() < deadline) {
      try {
        const response = await browser.runtime.sendMessage({ type: "PING_SIDEPANEL", windowId: destination });
        if (response?.ready) return;
      } catch { /* 侧栏脚本尚未开始监听。 */ }
      if (!alive) return;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { waits.delete(timer); resolve(); }, 80);
        waits.set(timer, resolve);
      });
    }
  }
  async function open(id: string, event: MouseEvent): Promise<void> {
    // 修饰键保留真实链接的浏览器默认行为，不改阅读状态或共享当前文章。
    if (!alive || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const item = view.collection.value.items.find(item => item.id === id);
    if (!item) return;
    const target = cardTarget(item.url); // 只放行 http/https，阻止收藏中的脚本地址。
    if (!target) { toast(t("invalidUrlShort")); return; }
    // 全屏与侧栏共享正在读的条目，另一页据此高亮并定位。
    view.state.currentItemId = item.id;
    void browser.storage.local.set({ [CURRENT]: item.id }).catch(() => {});
    const currentWindow = await resolveWindow();
    if (!alive) return;
    const openTab = await findOpen(target, { excludeTabId: tabId });
    if (!alive) return;
    const destination = openTab?.windowId ?? currentWindow;
    const opened = await openSidePanel(destination);
    if (!alive) return;
    if (!opened) {
      // 侧栏失败也不能让点击落空；此分支不自动标记在读。
      toast(t("sidePanelFallback"));
      if (openTab) await activate(openTab);
      else await browser.tabs.create({ url: target, openerTabId: tabId });
      return;
    }
    // 等侧栏就绪再跳转，避免读取导航中的空页面；超过 1500ms 仍继续。
    await waitForPanel(destination);
    if (!alive) return;
    if (view.preferences.value.autoMarkRead !== false && item.status === "unread") await items.update(item.id, { status: "reading" });
    if (!alive) return;
    // 已有原文标签直接激活，保留收藏库并避免重复页面。
    if (openTab) await activate(openTab);
    else if (tabId) await browser.tabs.update(tabId, { url: target });
    else await browser.tabs.create({ url: target });
  }
  async function newTab(id: string): Promise<void> {
    if (!alive) return;
    const target = cardTarget(view.collection.value.items.find(item => item.id === id)?.url);
    if (!target) { toast(t("invalidUrlShort")); return; }
    await browser.tabs.create({ url: target, active: false, openerTabId: tabId });
  }
  function dispose(): void { alive = false; waits.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); waits.clear(); }
  return { mount, open, newTab, tabId: () => tabId, dispose };
}
