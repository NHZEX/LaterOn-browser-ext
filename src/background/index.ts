import type { BackgroundTab, SaveInput } from "./shared";
import { errorMessage } from "./shared";
import { saveAllTabsInWindow, quickSave, confirmBatchSave } from "./save-workflow";
import { unwrapSuspendedTab } from "../shared/url-utils";
import { isWebUrl, usesEnglish } from "./shared";
import { registerFeedback, showLibraryCommandNotice, showActionError, toggleTranslation, reportFailure } from "./feedback";
import { MENU_SAVE_ALL, MENU_SAVE_PAGE } from "./browser-setup";
import { saveItem } from "./collection";
import { openLibrary, type LibraryContext } from "./navigation";
import { cancelPendingBatch, getPendingPickerPayload, createProject } from "./project-picker";
import { extractTabMetadataById } from "./metadata";
import { recordDiag } from "./diagnostics";
import { registerMessages } from "../storage/coordinator";
import { registerBackup } from "../backup/background";
import { registerReadingPosition } from "./reading-position";
import { registerOmnibox } from "./omnibox";
import { registerBrowserSetup } from "./browser-setup";
import { registerMaintenance } from "./maintenance";

type BackgroundMessage =
  | { readonly type: "SAVE_ITEM"; readonly item: SaveInput }
  | { readonly type: "OPEN_LIBRARY"; readonly context?: LibraryContext }
  | { readonly type: "CONFIRM_BATCH_SAVE"; readonly projectId?: string | null; readonly batchId?: string }
  | { readonly type: "CANCEL_BATCH_SAVE" | "GET_PENDING_PICKER"; readonly batchId?: string }
  | { readonly type: "CREATE_PROJECT"; readonly name: string; readonly epoch?: string }
  | { readonly type: "EXTRACT_METADATA"; readonly tabId?: number }
  | { readonly type: "QUICK_SAVE_TAB"; readonly tabId?: number; readonly source?: string };

export async function handleCommand(command: string, commandTab?: BackgroundTab) {
  // 「收藏当前窗口所有标签页」不依赖当前激活页是否为网页，单独处理。
  if (command === "save-all-tabs") {
    await saveAllTabsInWindow();
    return;
  }

  const rawTab = commandTab?.id
    ? commandTab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const tab = rawTab ? unwrapSuspendedTab(rawTab) : rawTab;

  if (!tab?.id || !isWebUrl(tab.url) || (command === "toggle-translation" && tab.suspended)) {
    // 在 StaySide 全屏收藏库里按 Alt+1 时，不能只在工具栏图标上挂一个「!」：
    // 页面本身已有 toast，就把“为什么不能收藏”直接说在人眼正在看的地方。
    // Chrome 设置页等其它受保护页面收不到扩展页消息，仍保留角标兜底。
    const explained = await showLibraryCommandNotice(rawTab, command);
    if (!explained) await showActionError();
    return;
  }

  if (command === "quick-save") {
    await quickSave(tab);
  } else if (command === "toggle-translation") {
    await toggleTranslation({ ...tab, id: tab.id });
  }
}

export function registerBackground() {
  // MV3 listeners must be registered synchronously on every worker start.
  registerMessages();
  registerBackup();
  registerReadingPosition();
  registerFeedback();
  registerOmnibox();
  registerBrowserSetup();
  registerMaintenance();
  // ── 新标签页劫持（已移除）──
  // 曾经支持「把新标签页换成 StaySide 全屏收藏墙」（设置项 newTabPage + onCreated 监听），
  // 现已下线：新标签恢复浏览器默认行为，不再有任何劫持。

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SAVE_ALL) {
      return saveAllTabsInWindow("menu").catch((error) => reportFailure(error, tab));
    } else if (info.menuItemId === MENU_SAVE_PAGE && tab?.id) {
      return quickSave(tab, "menu").catch((error) => reportFailure(error, tab));
    }
  });

  chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
    if (message.type === "SAVE_ITEM") {
      saveItem(message.item)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === "OPEN_LIBRARY") {
      openLibrary(message.context)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // 「选择项目」窗口点了确认：先回执让它马上关闭，再在后台继续收藏。
    if (message.type === "CONFIRM_BATCH_SAVE") {
      let replied = false;
      const reply = (payload: object) => {
        if (replied) return;
        replied = true;
        try {
          sendResponse(payload);
        } catch {
          // 窗口已经关掉时端口可能已断开，忽略即可。
        }
      };
      confirmBatchSave(message.projectId || null, reply, message.batchId)
        .then((result) => reply(result && result.ok === false ? result : { ok: true }))
        .catch((error) => reply({ ok: false, error: String(errorMessage(error)) }));
      return true;
    }
    if (message.type === "CANCEL_BATCH_SAVE") {
      cancelPendingBatch(message.batchId)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === "GET_PENDING_PICKER") {
      getPendingPickerPayload(message.batchId)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // 网页里的选项目浮层点了「新建」：统一由后台写库，保证数据和收藏库一致。
    if (message.type === "CREATE_PROJECT") {
      createProject(message.name, message.epoch)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // 弹窗 / 侧栏要显示「当前网页」的标题封面摘要时，统一由后台来抓。
    // 这样全网只有一份提取逻辑，不会出现「改了一处、另一处还是旧行为」。
    if (message.type === "EXTRACT_METADATA") {
      extractTabMetadataById(message.tabId)
        .then((response) => {
          // 记一笔「封面是从哪一层拿到的」，方便在设置页排查抓不到封面的站点。
          if (response?.ok) {
            recordDiag({
              lastCoverFrom: response.metadata?.imageFrom || "none",
              lastTitleFrom: response.metadata?.titleFrom || "none",
              lastCoverTitle: String(response.metadata?.title || "").slice(0, 60),
              lastCoverAt: Date.now()
            });
          }
          sendResponse(response);
        })
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // 侧边栏 / 工具栏小窗口里的「收藏当前网页」按钮。
    // 交给后台统一处理，这样它们和快捷键走的是同一条链路——
    // 设置里打开「收藏单篇前先选项目」时，点按钮同样会先弹浮层，而不是直接收藏。
    if (message.type === "QUICK_SAVE_TAB") {
      (async () => {
        let tab: BackgroundTab | null | undefined = null;
        try {
          const rawTab = message.tabId
            ? await chrome.tabs.get(message.tabId).catch(() => null)
            : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          tab = rawTab ? unwrapSuspendedTab(rawTab) : rawTab;
          if (!tab?.id || !isWebUrl(tab.url)) {
            sendResponse({ ok: false, error: (await usesEnglish()) ? "The current page can’t be added" : "当前页面无法添加" });
            return;
          }
          const result = await quickSave(tab, message.source || "panel");
          // result.pending 为真 = 已经弹出选项目浮层，真正的收藏要等用户确认。
          sendResponse(result || { ok: true });
        } catch (error) {
          if (tab?.suspended) await reportFailure(error, tab);
          sendResponse({ ok: false, error: String(errorMessage(error)) });
        }
      })();
      return true;
    }
  });

  // 快捷键触发：先记一笔「确实收到了按键」，再执行。
  // 这样即使后面执行失败，也能在设置页看出按键有没有到达扩展。
  chrome.commands.onCommand.addListener((command, tab) => {
    return (async () => {
      await recordDiag({ lastCommand: command, lastTrigger: "shortcut", lastCommandAt: Date.now() });
      let targetTab = tab;
      try {
        if (!targetTab?.id && command !== "save-all-tabs") {
          [targetTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        }
        await handleCommand(command, targetTab);
      } catch (error) {
        await reportFailure(error, targetTab);
      }
    })();
  });
}
