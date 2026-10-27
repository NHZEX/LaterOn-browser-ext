import type { TranslationResult } from "../content/translation.js";
import type { BackgroundTab } from "./shared";
interface Pill { readonly text: string; readonly kind?: string; }
import { errorMessage } from "./shared";
import { usesEnglish, isWebUrl } from "./shared";
import { recordDiag } from "./diagnostics";
import { unwrapSuspendedTab } from "../shared/url-utils";

// translation.css 只需给每个标签页注入一次，避免反复收藏时堆叠重复样式表。
const injectedCssTabs = new Set<number>();

async function ensureTranslationCss(tabId: number | undefined): Promise<void> {
  if (!tabId || injectedCssTabs.has(tabId)) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["translation.css"] });
    injectedCssTabs.add(tabId);
  } catch {
    // 页面受保护或已关闭，忽略即可。
  }
}

// ── 工具栏图标反馈 ──────────────────────────────────────────
// 品牌图标保持干净，不再常驻显示“当前网页已收藏”的 ✓；只有用户主动收藏时的
// 进度或错误会短暂出现，结束后恢复无角标的默认状态。
let actionFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

let actionFeedbackUntil = 0;

async function resetActionAppearance() {
  if (Date.now() < actionFeedbackUntil) return;
  const en = await usesEnglish();
  const baseTitle = en ? "Open the LaterOn side panel" : "打开 LaterOn 侧栏";
  await chrome.action?.setBadgeText?.({ text: "" });
  await chrome.action?.setTitle?.({ title: baseTitle });
}

async function showActionFeedback(text: string, color: string, duration: number): Promise<void> {
  actionFeedbackUntil = Date.now() + duration;
  clearTimeout(actionFeedbackTimer);
  await chrome.action?.setBadgeText?.({ text });
  await chrome.action?.setBadgeBackgroundColor?.({ color });
  actionFeedbackTimer = setTimeout(() => {
    actionFeedbackUntil = 0;
    resetActionAppearance().catch(() => {});
  }, duration);
}

async function toggleTranslation(tab: BackgroundTab & { readonly id: number }): Promise<void> {
  // 体积较大的网页执行代码保留在 content-translation.js，仅在实际使用时注入目标网页。
  await ensureTranslationCss(tab.id);
  const injection = await chrome.scripting.executeScript<[], TranslationResult>({
    target: { tabId: tab.id },
    world: "MAIN",
    files: ["content-translation.js"]
  });
  if (injection[0]?.result?.ok === false) await showActionError();
}

async function showActionError() {
  await showActionFeedback("!", "#d94841", 2200);
}

// 给全屏收藏库发送页内提示。runtime.sendMessage 能到达扩展自己的页面，
// 消息带 tabId，避免同时开着多个收藏库标签时每一页都弹一次。
async function showLibraryCommandNotice(tab: BackgroundTab | null | undefined, command: string): Promise<boolean> {
  if (!tab?.id) return false;
  const libraryUrl = chrome.runtime.getURL("library.html");
  if (!String(tab.url || "").startsWith(libraryUrl)) return false;
  const en = await usesEnglish();
  const message = command === "toggle-translation"
    ? (en ? "You’re in LaterOn. Open the page you want to translate, then press Alt+2." : "当前是 LaterOn，请打开需要翻译的网页后再按 Alt+2")
    : (en ? "You’re in LaterOn. Open the page you want to add, then press Alt+1." : "当前是 LaterOn，请先打开想添加的网页，再按 Alt+1");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SHOW_LIBRARY_NOTICE",
      tabId: tab.id,
      message
    });
    return response?.shown === true;
  } catch {
    return false;
  }
}

// 统一处理失败：记录原因（设置页可查）+ 角标提示 + 页内或系统通知，
// 避免出现「按了完全没反应、也不知道哪里错了」的情况。
async function reportFailure(error: unknown, targetTab: BackgroundTab | null = null): Promise<void> {
  const en = await usesEnglish();
  const message = String(errorMessage(error) || (en ? "Unknown error" : "未知错误"));
  await recordDiag({ lastError: message, lastErrorAt: Date.now() });
  await showActionError();
  try {
    const tab = targetTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    await showTabNotice(tab, en ? `Failed: ${pillTitle(message)}` : `操作失败：${pillTitle(message)}`);
  } catch {
    // 页面不支持注入时只保留角标提示。
  }
}

// 冻结页属于其他扩展，不能注入药丸；通知失败也不能改变已经完成的收藏结果。
async function showSystemNotice(text: string): Promise<void> {
  try {
    await chrome.notifications?.create?.("lateron-save-result", {
      type: "basic", title: "LaterOn", message: text,
      iconUrl: chrome.runtime.getURL("icon128.png"), silent: true
    });
  } catch {
    // 通知被禁用或接口不可用时，保留调用方已经显示的工具栏角标。
  }
}

async function showTabNotice(tab: BackgroundTab | null | undefined, text: string, kind = "", allowSystem = true): Promise<void> {
  if ((tab && unwrapSuspendedTab(tab))?.suspended) {
    if (allowSystem) await showSystemNotice(text);
    return;
  }
  if (tab?.id && isWebUrl(tab.url)) await showPagePills(tab.id, [{ text, kind }]);
}

// 在页面上弹「药丸」通知：显示在右上角（工具栏图标正下方）。
// messages 支持两种写法：纯文本，或 { text, kind }。
// kind="skip" 显示为灰色的次要提示；kind="move" 显示为橙色的「已搬家」提示。
// 逐条收藏时会一次弹一条，这里限制同屏最多 6 条，超出就让最早的先退场。
async function showPagePills(tabId: number | undefined, messages: readonly (string | Pill)[]): Promise<void> {
  const list = (messages || [])
    .map((item) => (typeof item === "string" ? { text: item, kind: "" } : item))
    .filter((item) => item && item.text);
  if (!tabId || !list.length) return;

  const MAX_PILLS = 10;
  const shown = list.slice(0, MAX_PILLS);
  const overflow = list.length - shown.length;
  const en = await usesEnglish();

  await ensureTranslationCss(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (items: readonly Pill[], extra: number, overflowText: string) => {
      const hostId = "lateron-pill-stack";
      let host = document.getElementById(hostId);
      if (!host) {
        host = document.createElement("div");
        host.id = hostId;
        document.documentElement.appendChild(host);
      }
      const MAX_STACK = 6;
      const all = extra > 0 ? [...items, { text: overflowText, kind: "" }] : [...items];
      all.forEach((item, index) => {
        const pill = document.createElement("div");
        pill.className = "lateron-pill";
        if (item.kind) pill.classList.add(`is-${item.kind}`);
        pill.textContent = item.text;
        host.appendChild(pill);
        while (host.childElementCount > MAX_STACK) host.firstElementChild!.remove();
        const hide = () => {
          pill.classList.add("is-out");
          window.setTimeout(() => {
            pill.remove();
            if (!host.childElementCount) host.remove();
          }, 260);
        };
        const delay = index * 90;
        window.setTimeout(() => pill.classList.add("is-in"), 30 + delay);
        window.setTimeout(hide, 4200 + delay);
      });
    },
    args: [shown, overflow, en ? `${overflow} more added` : `还有 ${overflow} 篇已添加`]
  });
}

// 把一条标题压缩成适合放进药丸的单行短文本。
function pillTitle(text: string | undefined): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean;
}

// 把通知发到指定标签页；标签已关闭或不是普通网页时，退回「当前活动标签页」。
function notifyTab(tabId: number | null | undefined, text: string, kind = "", allowSystem = true): Promise<void> {
  if (tabId == null) return notifyOnActiveTab(text, kind, allowSystem);
  return chrome.tabs
    .get(tabId)
    .then((tab) => (tab?.id != null && (isWebUrl(tab.url) || (tab && unwrapSuspendedTab(tab))?.suspended)
      ? showTabNotice(tab, text, kind, allowSystem) : notifyOnActiveTab(text, kind, allowSystem)))
    .catch(() => notifyOnActiveTab(text, kind, allowSystem));
}

// 在当前窗口的「活动标签页」上弹一条药丸通知。
// 若当前停在 Chrome 内部页面（新标签页 / 设置页等）无法注入，则只保留角标提示。
async function notifyOnActiveTab(text: string, kind = "", allowSystem = true): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await showTabNotice(tab, text, kind, allowSystem);
  } catch {
    // 内部页面不允许注入，忽略即可。
  }
}

export function registerFeedback() {
  // 页面跳转后注入的样式会失效、标签关闭后记录也没意义，这里及时清掉标记，
  // 保证下次提示时样式能重新注入（否则药丸会变成没有样式的裸文本）。
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading" || typeof changeInfo.url === "string") injectedCssTabs.delete(tabId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => injectedCssTabs.delete(tabId));

  resetActionAppearance().catch(() => {});
}

export { resetActionAppearance, showLibraryCommandNotice, showActionError, toggleTranslation, reportFailure, pillTitle, showActionFeedback, showTabNotice, showPagePills, showSystemNotice, notifyTab };
