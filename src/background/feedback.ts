import type { TranslationResult } from "../content/translation";
import type { BackgroundTab, BackgroundSnapshot } from "./shared";
import type { StoredSettings } from "../settings/shared";
import type { PageNotice, NoticeKind } from "../content/page-notice";
import { showPageNotices } from "../content/page-notice";
import accentStyles from "../styles/accent-vars.css?raw";
import noticeStyles from "../styles/page-notice.css?raw";
import { errorMessage } from "./shared";
import { usesEnglish, isWebUrl, SETTINGS_KEY } from "./shared";
import { recordDiag } from "./diagnostics";
import { unwrapSuspendedTab } from "../shared/url-utils";
import type { SystemNoticeResult } from "../shared/notifications";

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
  const baseTitle = en ? "Open the StaySide side panel" : "打开 StaySide 侧栏";
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
    ? (en ? "You’re in StaySide. Open the page you want to translate, then press Alt+2." : "当前是 StaySide，请打开需要翻译的网页后再按 Alt+2")
    : (en ? "You’re in StaySide. Open the page you want to add, then press Alt+1." : "当前是 StaySide，请先打开想添加的网页，再按 Alt+1");
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
    await showTabNotice(tab, en ? `Failed: ${pillTitle(message)}` : `操作失败：${pillTitle(message)}`, "error");
  } catch {
    // 页面不支持注入时只保留角标提示。
  }
}

// 冻结页属于其他扩展，不能注入药丸；通知失败也不能改变已经完成的收藏结果。
async function createSystemNotice(text: string): Promise<SystemNoticeResult> {
  if (!await chrome.permissions.contains({ permissions: ["notifications"] })) return { status: "permission-missing" };
  const api = chrome.notifications;
  if (!api?.create || !api.getPermissionLevel) return { status: "unavailable" };
  if (await api.getPermissionLevel() !== "granted") return { status: "blocked" };
  await api.create("lateron-save-result", {
    type: "basic", title: "StaySide", message: text,
    iconUrl: chrome.runtime.getURL("icon128.png"), silent: true
  });
  // API 接收成功不能证明操作系统已经展示横幅。
  return { status: "sent" };
}

async function showSystemNotice(text: string, source: "save" | "test" = "save"): Promise<SystemNoticeResult> {
  const result = await createSystemNotice(text).catch((error: unknown): SystemNoticeResult => ({
    status: "failed", error: String(errorMessage(error))
  }));
  await recordDiag({ lastNotificationAt: Date.now(), lastNotificationStatus: result.status,
    lastNotificationSource: source, lastNotificationError: result.error || "" });
  return result;
}

export async function testSystemNotice(): Promise<SystemNoticeResult> {
  const en = await usesEnglish();
  return showSystemNotice(en ? "Test notification: save results for suspended tabs appear here."
    : "测试通知：冻结页收藏结果会显示在这里。", "test");
}

async function showTabNotice(tab: BackgroundTab | null | undefined, text: string | PageNotice, kind: NoticeKind = "", allowSystem = true): Promise<void> {
  const notice = typeof text === "string" ? { text, kind } : text;
  if ((tab && unwrapSuspendedTab(tab))?.suspended) {
    if (allowSystem) await showSystemNotice(notice.text);
    return;
  }
  if (tab?.id && isWebUrl(tab.url)) await showPagePills(tab.id, [notice]);
}

// 页内结果卡片隔离网页样式；只有新增收藏播放主题色高亮，同屏最多保留 6 条。
async function showPagePills(tabId: number | undefined, messages: readonly (string | PageNotice)[]): Promise<void> {
  const list = (messages || [])
    .map((item): PageNotice => (typeof item === "string" ? { text: item } : item))
    .filter((item) => item && item.text);
  if (!tabId || !list.length) return;

  const MAX_PILLS = 10;
  const shown = list.slice(0, MAX_PILLS);
  const overflow = list.length - shown.length;
  const settings: StoredSettings = await chrome.storage.local.get<BackgroundSnapshot>(SETTINGS_KEY)
    .then(stored => stored[SETTINGS_KEY] || {}, () => ({}));
  const en = settings.language === "en";
  await chrome.scripting.executeScript({
    target: { tabId },
    func: showPageNotices,
    args: [shown, overflow, en ? `${overflow} more added` : `还有 ${overflow} 篇已添加`, settings.theme || "light", `${accentStyles}\n${noticeStyles}`]
  });
}

// 把一条标题压缩成适合放进药丸的单行短文本。
function pillTitle(text: string | undefined): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean;
}

// 把通知发到指定标签页；标签已关闭或不是普通网页时，退回「当前活动标签页」。
function notifyTab(tabId: number | null | undefined, text: string | PageNotice, kind: NoticeKind = "", allowSystem = true): Promise<void> {
  if (tabId == null) return notifyOnActiveTab(text, kind, allowSystem);
  return chrome.tabs
    .get(tabId)
    .then((tab) => (tab?.id != null && (isWebUrl(tab.url) || (tab && unwrapSuspendedTab(tab))?.suspended)
      ? showTabNotice(tab, text, kind, allowSystem) : notifyOnActiveTab(text, kind, allowSystem)))
    .catch(() => notifyOnActiveTab(text, kind, allowSystem));
}

// 在当前窗口的「活动标签页」上弹一条药丸通知。
// 若当前停在 Chrome 内部页面（新标签页 / 设置页等）无法注入，则只保留角标提示。
async function notifyOnActiveTab(text: string | PageNotice, kind: NoticeKind = "", allowSystem = true): Promise<void> {
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
