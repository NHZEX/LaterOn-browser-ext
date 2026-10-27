import type { Browser } from "wxt/browser";
import type { BackgroundSnapshot } from "./shared";
import { normalize as normalizeUrl } from "../shared/url-utils";
import { enqueue } from "../storage/coordinator";

// 已收藏网页的“上次滚动位置”：只保存 scrollY，不记录百分比、时间或阅读统计。
// 后台负责同步注册监听；网页端脚本只在已收藏页面上按需注入。
export function registerReadingPosition() {
  const ITEMS_KEY = "laterOnItems";
  const POSITIONS_KEY = "laterOnReadingPositions";
  const SETTINGS_KEY = "laterOnSettings";

  const isWebUrl = (url: string | undefined) => /^https?:\/\//i.test(String(url || ""));

  async function setupTab(tabId: number, suppliedTab?: Browser.tabs.Tab): Promise<boolean> {
    try {
      const tab = suppliedTab?.id === tabId ? suppliedTab : await chrome.tabs.get(tabId);
      if (!tab?.id || !isWebUrl(tab.url)) return false;
      const stored = await chrome.storage.local.get<BackgroundSnapshot>([ITEMS_KEY, POSITIONS_KEY, SETTINGS_KEY]);
      const item = (stored[ITEMS_KEY] || []).find((entry) => normalizeUrl(entry.url) === normalizeUrl(tab.url ?? ""));
      if (!item) {
        await chrome.tabs.sendMessage(tab.id, { type: "LATERON_READING_POSITION_INIT", itemId: null }).catch(() => {});
        return false;
      }

      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-reading-position.js"] });
      await chrome.tabs.sendMessage(tab.id, {
        type: "LATERON_READING_POSITION_INIT",
        itemId: item.id,
        y: Math.max(0, Number(stored[POSITIONS_KEY]?.[item.id]) || 0),
        language: stored[SETTINGS_KEY]?.language === "en" ? "en" : "zh-CN"
      });
      return true;
    } catch {
      // 标签可能已关闭、正在跳转，或属于浏览器保护页面；都不影响正常浏览。
      return false;
    }
  }

  async function setupActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await setupTab(tab.id, tab);
  }

  function savePosition(itemId: string, rawY: unknown): Promise<boolean> {
    const y = Math.max(0, Math.round(Number(rawY) || 0));
    return enqueue(async () => {
      const stored = await chrome.storage.local.get<BackgroundSnapshot>([ITEMS_KEY, POSITIONS_KEY]);
      if (!(stored[ITEMS_KEY] || []).some((item) => item.id === itemId)) return false;
      const positions = { ...(stored[POSITIONS_KEY] || {}) };
      if (Math.abs(Number(positions[itemId] || 0) - y) < 8) return true;
      positions[itemId] = y;
      await chrome.storage.local.set({ [POSITIONS_KEY]: positions });
      return true;
    });
  }

  async function cleanOrphanedPositions() {
    return enqueue(async () => {
      // Re-read inside the shared queue: an onChanged event can predate an import.
      const stored = await chrome.storage.local.get<BackgroundSnapshot>([ITEMS_KEY, POSITIONS_KEY]);
      const known = new Set((stored[ITEMS_KEY] || []).map((item) => item.id));
      const positions = stored[POSITIONS_KEY] || {};
      const next = Object.fromEntries(Object.entries(positions).filter(([id]) => known.has(id)));
      if (Object.keys(next).length !== Object.keys(positions).length) {
        await chrome.storage.local.set({ [POSITIONS_KEY]: next });
      }
    });
  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" || typeof changeInfo.url === "string") {
      setupTab(tabId, tab).catch(() => {});
    }
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => setupTab(tabId).catch(() => {}));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[ITEMS_KEY]) {
      cleanOrphanedPositions().catch(() => {});
      setupActiveTab().catch(() => {});
    }
    if (changes[SETTINGS_KEY]) setupActiveTab().catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "SAVE_READING_POSITION" || !message.itemId) return;
    savePosition(message.itemId, message.y)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });
}
