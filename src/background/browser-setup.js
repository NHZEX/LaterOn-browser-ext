import { SETTINGS_KEY } from "./shared.js";

// ── 右键菜单：不依赖快捷键的备用入口 ────────────────────────
// 快捷键只在「扩展首次安装」时由 Chrome 绑定，且可能被系统占用；
// 右键菜单任何时候都能用，作为兜底。
const MENU_SAVE_ALL = "lateron-save-all-tabs";
const MENU_SAVE_PAGE = "lateron-save-page";
let contextMenuRefresh = Promise.resolve();

function setupContextMenus() {
  // onStartup / onInstalled / 设置变更可能同时触发刷新；串行执行 removeAll → create，
  // 避免两个回调交错后创建出 duplicate id。每次 create 都消费 lastError，
  // 防止 Chrome 把竞态错误冒泡成「Unchecked runtime.lastError」。
  contextMenuRefresh = contextMenuRefresh.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY).catch(() => ({}));
    const language = stored[SETTINGS_KEY]?.language === "en" ? "en" : "zh-CN";
    const titles = language === "en"
      ? { page: "Add this page to LaterOn", all: "Add all tabs in this window to LaterOn" }
      : { page: "添加此页面到 LaterOn", all: "添加本窗口所有标签页到 LaterOn" };
    await new Promise((resolve) => {
      try {
        chrome.contextMenus.removeAll(() => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch {
        resolve();
      }
    });
    const create = (options) => {
      try {
        chrome.contextMenus.create(options, () => { void chrome.runtime.lastError; });
      } catch {
        // 菜单已存在或权限未就绪时忽略。
      }
    };
    create({ id: MENU_SAVE_PAGE, title: titles.page, contexts: ["page", "action"] });
    create({ id: MENU_SAVE_ALL, title: titles.all, contexts: ["page", "action"] });
  });
  return contextMenuRefresh;
}

// Chrome 与 Edge 共用 Side Panel API。manifest 里不再绑定 default_popup，
// 再显式开启 openPanelOnActionClick，工具栏图标便会在两端直接切换 LaterOn 侧栏。
// 该偏好由浏览器保存；service worker 冷启动、浏览器启动和扩展升级时都重新确认一次，
// 避免 Edge 更新、扩展重新加载或浏览器同步后退回默认的“图标无动作”。
async function setupSidePanelAction() {
  if (typeof chrome.sidePanel?.setPanelBehavior !== "function") return false;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return true;
  } catch {
    return false;
  }
}

export function registerBrowserSetup() {
  // 工具栏左键由 setPanelBehavior 交给浏览器：打开 / 聚焦侧栏。
  setupContextMenus();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) setupContextMenus();
  });

  setupSidePanelAction();

  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenus();
    setupSidePanelAction();
  });

  chrome.runtime.onStartup.addListener(() => {
    setupContextMenus();
    setupSidePanelAction();
  });
}

export { MENU_SAVE_ALL, MENU_SAVE_PAGE };
