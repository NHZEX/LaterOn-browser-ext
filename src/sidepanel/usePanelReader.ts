import { browser } from "wxt/browser";
import { activate, findOpen } from "../tabs/navigation";
import { cardTarget } from "../shared/card-media";
import { CURRENT } from "../storage/contracts";
import type { SidepanelControls } from "./useSidepanelControls";
import type { PanelCommands } from "./usePanelCommands";
import type { PanelItems } from "./usePanelItems";

export function usePanelReader(controls: SidepanelControls, commands: PanelCommands, items: PanelItems) {
  let alive = true;
  async function markReading(id: string): Promise<void> {
    const item = commands.find(id);
    if (alive && commands.current() && controls.autoMarkRead.value && item?.status === "unread") await items.update(id, { status: "reading" });
  }
  function open(id: string): Promise<void> {
    return commands.perform(`open:${id}`, async () => {
      const target = cardTarget(commands.find(id)?.url);
      if (!target) { commands.notify("invalidItemUrl"); return; }
      // 全屏据共享标记高亮并滚动定位，本页也不依赖自身存储广播。
      commands.setCurrent(id);
      void browser.storage.local.set({ [CURRENT]: id }).catch(() => {});
      const tab = await findOpen(target);
      if (!alive || !commands.current() || !commands.find(id)) return;
      if (tab) {
        await markReading(id);
        if (!alive) return;
        await activate(tab);
        // 命中的文章可能在另一窗口，让 LaterOn 侧栏跟到那个窗口。
        if (alive && tab.windowId != null && typeof browser.sidePanel?.open === "function") {
          await browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
        }
        return;
      }
      // 侧栏依附当前网页，普通点击不能覆盖它；找不到原文标签就新建前台标签。
      try { await browser.tabs.create({ url: target, active: true }); }
      catch { commands.notify("invalidItemUrl"); return; }
      await markReading(id);
    });
  }
  function newTab(id: string): Promise<void> {
    return commands.perform(`open:${id}`, async () => {
      const target = cardTarget(commands.find(id)?.url);
      if (!target) { commands.notify("invalidItemUrl"); return; }
      // 与 Ctrl/⌘ 点击一致，在当前窗口后台新建，不打断侧栏中的浏览。
      try { await browser.tabs.create({ url: target, active: false }); }
      catch { commands.notify("invalidItemUrl"); }
    });
  }
  return { open, newTab, dispose: () => { alive = false; } };
}
