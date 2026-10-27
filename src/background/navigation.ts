import type { Browser } from "wxt/browser";
export interface LibraryContext {
  readonly source?: string;
  readonly projectId?: string;
  readonly filter?: string;
  readonly focusItemId?: string;
}
async function openLibrary(context: LibraryContext | null = null): Promise<void> {
  const baseUrl = chrome.runtime.getURL("library.html");
  const target = new URL(baseUrl);
  // 只有从侧栏明确点「展开全屏」时才携带现场；工具栏、快捷键等普通入口
  // 继续打开没有参数的首页，因此仍以「全部项目」作为默认落点。
  if (context?.source === "sidepanel") {
    target.searchParams.set("from", "sidepanel");
    if (context.projectId) target.searchParams.set("project", String(context.projectId));
    if (context.filter) target.searchParams.set("filter", String(context.filter));
    if (context.focusItemId) target.searchParams.set("focus", String(context.focusItemId));
  }
  const url = target.href;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => {
    const candidate = tab.url || tab.pendingUrl || "";
    return candidate === baseUrl || candidate.startsWith(`${baseUrl}?`) || candidate.startsWith(`${baseUrl}#`);
  });
  if (existing?.id) {
    const patch: Browser.tabs.UpdateProperties = { active: true };
    // 已经打开的收藏库也要接住侧栏当前现场；更新 URL 会让它重新初始化，
    // 比在两个页面之间额外维护一条临时消息链更可靠。
    if ((existing.url || existing.pendingUrl) !== url) patch.url = url;
    await chrome.tabs.update(existing.id, patch);
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

export { openLibrary };
