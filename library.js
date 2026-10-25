import { nextTick } from "vue";
import { normalizeFilter, normalizeSort } from "./src/collection/filter";
import { projectPickerFolders, cardTarget } from "./src/library/shared";

// Vue owns rendering and collection commands; this transitional controller retains navigation and page adapters.
/** @param {import("./src/library/useLibraryControls").LibraryControls} controls */
export function startLibraryPage(controls) {
const view = controls.state;
const STORAGE_KEY = "laterOnItems";
const PROJECTS_KEY = "laterOnProjects";
const ACTIVE_PROJECT_KEY = "laterOnActiveProject";
const SETTINGS_KEY = "laterOnSettings";
const SIDEBAR_WIDTH_KEY = "laterOnSidebarWidth";
// 全屏与侧栏共享的「当前正在读哪篇」标记：任意一方点开文章都写它，
// 另一方据此高亮 + 滚动定位，保证两个视图的阅读位置一致。
const CURRENT_ITEM_KEY = "laterOnCurrentItem";
// 全屏与侧栏共享的「当前筛到哪一档」（全部 / 未读 / 已读）：
// 一边切换筛选，另一边跟着切——不用两边各点一次。
const FILTER_KEY = "laterOnFilter";
const FILTER_CHOSEN_KEY = "laterOnFilterChosen";
const DEFAULT_FILTER = "unread";
// 「自定义顺序」：用户在一个项目里拖出来的阅读顺序。
// 结构是 { 范围: [收藏 id, ...] }，范围是 "all" / "unfiled" / 某个项目 id——
// 每个项目各自记一份，互不干扰。
const ORDER_KEY = "laterOnOrder";
// 用户自己上传的封面（体积大）：单独放一个键，不和收藏列表混在一个数组里。
// 否则每次读写列表都要「连图一起搬」，数据攒多了哪个页面打开都会卡很久。
const COVERS_KEY = "laterOnCovers";
let items = [];
let projects = [];
let orders = {};
// 首页用品牌 slogan；用户明确进入某个导航范围后，标签页改成对应范围名称。
let pageTitleMode = "home";
let autoMarkRead = true;
// 视图：全部项目 = 图板（一个类目一张），待整理 / 某个项目 = 卡片列表。
// 不再提供手动切换——图板只在「全部项目」总览下有意义，钻进某个项目就是卡片。
let settings = {};          // 当前设置（主题等）：卡片上弹浮层时要跟它对齐配色
let libraryTabId = null;
let libraryWindowId = null;
let currentItemId = null;     // 当前正在读的文章 id（来自 CURRENT_ITEM_KEY，两个视图共享）
// 从侧栏展开全屏时，等目标卡片真正分批渲染出来后再滚过去；普通打开首页不定位。
let initialLocateItemId = null;
let covers = {};              // 用户上传的封面：{ 收藏 id: dataURL }（与 COVERS_KEY 对应）
const grid = document.querySelector("#cardGrid");
const searchInput = document.querySelector("#searchInput");
const toast = document.querySelector("#toast");
const tr = (key, vars) => {
  if (window.LaterOnI18n?.t) return window.LaterOnI18n.t(key, vars);
  const fallback = {
    deleteProject: "删除项目", deleteProjectTitle: "删除项目「{name}」？", deleteProjectItems: "项目及其中的 {n} 篇网页将一起删除，删除后无法恢复。", deleteEmptyProject: "这个项目里还没有网页，删除后无法恢复。", projectDeletedWithItems: "已删除项目「{name}」及其中的 {n} 篇网页", projectDeleted: "已删除项目「{name}」",
    archive: "归档", archiveProject: "归档项目", restoreProject: "恢复项目", projectArchived: "项目及内容已归档，可在归档中恢复", projectRestored: "项目及内容已恢复",
    noInbox: "还没有要整理的", searchCount: "在全部网页里找到 {count} 篇 · {unfinished} 篇没看完",
    scopedCount: "{count} 篇网页 · {unfinished} 篇没看完", noMatches: "没有找到匹配的网页",
    noMatchesHint: "换个关键词，或切换顶部的阅读状态筛选。", quiet: "这里还很安静",
    quietHint: "打开一个有价值的网页，点击浏览器工具栏中的 LaterOn 图标即可添加。",
    noBoard: "没有匹配的类目", noBoardHint: "换个关键词，或切换顶部的阅读状态筛选。",
    boardCount: "{groups} 个项目 · 共 {total} 篇网页 · {unfinished} 篇没看完", notFinished: "没看完",
    slogan: "有价值的网页，留给 LaterOn。", inbox: "等待整理", allProjectsOverview: "全部项目",
    openInNewWindow: "在新窗口打开", openingNewWindow: "正在新窗口打开 {n} 篇…",
    openedNewWindow: "已在新窗口打开 {n} 篇", newWindowOpenFailed: "新窗口打开失败，请重试",
    noValidPages: "选中的内容里没有可打开的网页",
    customSortEnabled: "已切到“自定义顺序”，这次排序已保存",
    mainlyFrom: "主要来自 {sources}", updatedAt: "{time}更新",
    coverPicksHint: "点一下加入、点 × 取消，最多 3 张；第 1 张占左边大格，拖动缩略图可以调顺序。",
    noCoverPicked: "还没挑——现在按项目里的网页自动拼封面。",
    coverPickLimitError: "封面最多用 {n} 张，先点 × 取消一张。",
    coverPicksFull: "已经挑满 {n} 张，想换别的先点 × 取消一张。",
    customCoverActive: "上面那张自定义封面正生效，移除它才会用下面挑的这几张。",
    projectUpdateCollage: "封面组合", projectChangesSaved: "{changes}已保存"
  };
  return String(fallback[key] || key).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? `{${k}}`);
};

function syncDocumentTitle() {
  let pageName = "";
  if (pageTitleMode === "home") {
    pageName = tr("slogan");
  } else if (view.activeProject === "unfiled") {
    pageName = tr("inbox");
  } else if (view.activeProject === "archive") {
    pageName = tr("archive");
  } else if (view.activeProject === "all") {
    pageName = tr("allProjectsOverview");
  } else {
    pageName = projects.find((project) => project.id === view.activeProject)?.name || tr("allProjectsOverview");
  }
  document.title = `LaterOn - ${pageName}`;
}

// 在全屏收藏库里按 Alt+1 / Alt+2 时，后台不能对这个扩展页面执行网页收藏或翻译。
// 直接复用本页 toast 解释原因，避免用户只看到工具栏图标上的「!」却不知道发生了什么。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SHOW_LIBRARY_NOTICE") return;
  if (message.tabId != null && libraryTabId != null && message.tabId !== libraryTabId) return;
  showToast(message.message || tr("openRegularPage"), 3200, "pill");
  sendResponse({ shown: true });
});

init();

function normalizeItems(list) {
  return LaterOnItemState.normalizeItems(list);
}

// 一次性搬家：把还躺在收藏列表里的 base64 封面挪到单独的键里。
// 搬完列表数据回归「纯文字」，哪个页面打开都快。已搬过（没有 data: 封面）就什么都不做。
async function migrateLegacyCovers(rawItems) {
  if (!LaterOnItemState.needsLegacyMigration(rawItems)) return null;
  try {
    const response = await LaterOnStorage.run("migrateLegacyData");
    covers = response.covers;
    return response.items;
  } catch { return null; }
}

// 筛选只认这三档。第一次打开还没有偏好，或存入了异常值时，默认展示「未读」；
// 用户手动切换后会写进 FILTER_KEY，以后恢复上次选择。
// 搜索是临时查看状态；切换项目或移动收藏后离开搜索结果，避免旧关键词继续过滤新页面。
function clearSearch() {
  controls.clearSearch();
}
// 切换筛选：先本地生效，再写进共享存储，让另一个视图跟着切。
async function setFilter(value) {
  const next = normalizeFilter(value);
  if (next === view.filter) return;
  view.filter = next;
  render();
  try { await chrome.storage.local.set({ [FILTER_KEY]: view.filter, [FILTER_CHOSEN_KEY]: true }); } catch { /* 存不下就算了，本地筛选照常用 */ }
}

async function init() {
  await window.LaterOnI18n?.getLanguage();
  window.LaterOnI18n?.applyStatic();
  const [result, activeTabs] = await Promise.all([
    chrome.storage.local.get([STORAGE_KEY, PROJECTS_KEY, ACTIVE_PROJECT_KEY, SETTINGS_KEY, CURRENT_ITEM_KEY, FILTER_KEY, FILTER_CHOSEN_KEY, ORDER_KEY, COVERS_KEY, SIDEBAR_WIDTH_KEY, "laterOnCollectionEpoch"]),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  LaterOnStorage.initialize(result);
  controls.sidebar.bind({ saved: result[SIDEBAR_WIDTH_KEY],
    save: (width) => chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: width }),
    subscribe: (changed) => {
      const listener = (changes, area) => { if (area === "local" && changes[SIDEBAR_WIDTH_KEY]) changed(changes[SIDEBAR_WIDTH_KEY].newValue); };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener?.(listener);
    } });
  covers = result[COVERS_KEY] || {};
  const migrated = await migrateLegacyCovers(result[STORAGE_KEY]);
  const rawItems = migrated || result[STORAGE_KEY] || [];
  items = normalizeItems(rawItems);
  projects = sortPinnedFirst(result[PROJECTS_KEY] || []);
  orders = result[ORDER_KEY] || {};
  const launchParams = new URLSearchParams(window.location.search);
  const launchedFromSidepanel = launchParams.get("from") === "sidepanel";
  // 普通打开仍落在“全部项目”首页；只有用户从侧栏主动展开时，才延续侧栏的项目现场。
  view.activeProject = launchedFromSidepanel
    ? normalizeProject(launchParams.get("project") || result[ACTIVE_PROJECT_KEY])
    : "all";
  pageTitleMode = launchedFromSidepanel ? "section" : "home";
  currentItemId = result[CURRENT_ITEM_KEY] || null;
  const userSettings = result[SETTINGS_KEY] || {};
  view.sort = normalizeSort(userSettings.defaultSort);
  autoMarkRead = userSettings.autoMarkRead !== false;
  // 旧版本会在回首页时写入 all，但那不是用户的筛选偏好；升级后首次打开回到未读。
  view.filter = launchedFromSidepanel
    ? normalizeFilter(launchParams.get("filter") || result[FILTER_KEY])
    : (result[FILTER_CHOSEN_KEY] ? normalizeFilter(result[FILTER_KEY]) : DEFAULT_FILTER);
  // 地址栏输入 `lo 关键词` 后，默认回车会把用户带到这页并附上搜索词。
  // 此入口明确是在找收藏，所以临时查看全部阅读状态，不把这个选择写回用户的日常筛选偏好。
  const launchQuery = String(launchParams.get("q") || "").trim();
  if (launchQuery) {
    view.query = launchQuery.toLowerCase();
    view.search = launchQuery;
    if (launchParams.get("from") === "omnibox") view.filter = "all";
    pageTitleMode = "section";
  }
  // focus 只接受当前共享的正在读条目，防止陈旧链接把另一篇卡片误当成当前文章。
  const requestedFocus = launchParams.get("focus");
  initialLocateItemId = launchedFromSidepanel && requestedFocus === currentItemId ? currentItemId : null;
  libraryTabId = activeTabs[0]?.id || null;
  libraryWindowId = activeTabs[0]?.windowId || null;
  render();
  renderProjects();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    items = normalizeItems(changes[STORAGE_KEY].newValue || []);
    render();
    renderProjects();
  }
  if (area === "local" && changes[COVERS_KEY]) {
    covers = changes[COVERS_KEY].newValue || {};
    render();
  }
  if (area === "local" && changes[PROJECTS_KEY]) {
    projects = sortPinnedFirst(changes[PROJECTS_KEY].newValue || []);
    render();
    renderProjects();
  }
  if (area === "local" && changes[ACTIVE_PROJECT_KEY]) {
    const nextProject = normalizeProject(changes[ACTIVE_PROJECT_KEY].newValue);
    // 自己点击导航时本地状态已经先更新；别让随后到达的 storage 回声把首页标题
    // 从 slogan 又改回「全部项目」。只有另一个视图真正切换了范围才接管。
    if (nextProject !== view.activeProject) {
      view.activeProject = nextProject;
      pageTitleMode = "section";
      renderProjects();
      render();
    }
  }
  if (area === "local" && changes[SETTINGS_KEY]) {
    const s = changes[SETTINGS_KEY].newValue || {};
    if (s.defaultSort && normalizeSort(s.defaultSort) !== view.sort) { view.sort = normalizeSort(s.defaultSort); render(); }
    if (typeof s.autoMarkRead === "boolean") autoMarkRead = s.autoMarkRead;
  }
  if (area === "local" && changes[CURRENT_ITEM_KEY]) {
    currentItemId = changes[CURRENT_ITEM_KEY].newValue || null;
    initialLocateItemId = currentItemId;
    view.currentItemId = currentItemId;
    nextTick(() => cardsRendered(false));
  }
  if (area === "local" && changes[ORDER_KEY]) {
    orders = changes[ORDER_KEY].newValue || {};
    render();
  }
  if (area === "local" && changes[FILTER_KEY]) {
    // 侧栏那边切了筛选 → 这边跟着切（反过来同理）。自己写的值不会变，自然被这个判断挡掉。
    const next = normalizeFilter(changes[FILTER_KEY].newValue);
    if (next !== view.filter) { view.filter = next; render(); }
  }
});

async function openSettings(event) {
  const url = chrome.runtime.getURL("settings.html");
  // 默认就在「当前这个标签页」里切到设置页，点设置页的「返回」正好回到刚才的收藏墙。
  // 按住 ⌘ / Ctrl / Shift 点，仍按老习惯在新标签页打开。
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    chrome.tabs.create({ url });
    return;
  }
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.update(tab.id, { url });
  else chrome.tabs.create({ url });
}

// 点左上角的 LaterOn 标识 = 回「全屏首页」。
// 首页 = 这一页刚打开时的那一屏：全部项目（图板总览）+ 筛选回到「未读」+ 没有搜索词 + 滚到顶。
// 之所以要一次性复位这么多：钻进某个项目或筛到「未读」之后，用户对「怎么退回去」是没有把握的，
// 点品牌标识就是那个万能的后退——不用去猜自己刚才点过什么。
function goHome() {
  clearSearch();
  setFilter("unread");
  selectProject("all", { asHome: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 文章打开暂由网格委托；卡片编辑、阅读、移动和删除事件已由 Vue 接管。
grid.addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  const item = items.find((entry) => entry.id === card.dataset.id);
  if (!item) return;
  if (event.target.closest(".title-link, .cover-link")) openItem(event, item);
  // 来源、摘要和卡片留白也是用户自然会点的区域。卡片本身又能拖拽，
  // 如果这些位置只显示操作光标却没有反应，就会形成误导性死区。
  // 排除所有真正的交互控件后，其余卡片区域统一按“打开文章”处理。
  else if (!event.target.closest("button, select, input, label, a")) openItem(event, item);
});
// 卡片上右键 = 这一篇的菜单（打开 / 标记已读 / 编辑 / 移动 / 多选 / 删除）。
// 和多选模式不冲突：多选时右键照样出菜单，只是「多选」那一项变成「取消选择」。
grid.addEventListener("contextmenu", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  const item = items.find((entry) => entry.id === card.dataset.id);
  if (!item) return;
  // 不拦掉默认行为的话，浏览器会把自己的原生菜单叠在我们那个上面。
  event.preventDefault();
  controls.itemMenu(item.id, event.clientX, event.clientY, card);
});
grid.addEventListener("keydown", (event) => {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  const card = event.target.closest(".card");
  if (!card) return;
  event.preventDefault();
  const rect = card.getBoundingClientRect();
  controls.itemMenu(card.dataset.id, rect.right, rect.top, event.target);
});

async function saveSortSetting() {
  // 排序写入共享设置，让侧栏与全屏保持一致，并在下次打开时恢复。
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = stored[SETTINGS_KEY] || {};
    if (settings.defaultSort === view.sort) return;
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, defaultSort: view.sort } });
  } catch { /* 存不下就算了，本次会话的排序照常用 */ }
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (controls.menu.value) { controls.closeMenu(); return; }
    if (view.renamingId) { controls.cancelRename(); return; }
    return;
  }
  // F2 = 给正在查看的项目改名（和系统的文件管理器一致的习惯）。
  if (event.key === "F2" && !isTypingTarget(event.target) && projects.some((project) => project.id === view.activeProject)) {
    event.preventDefault();
    controls.rename(view.activeProject);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); searchInput.focus();
  }
});

function isTypingTarget(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}

function syncCollection() {
  controls.updateOrders(orders);
  controls.updateCollection({ items, projects, covers });
}

function render() {
  syncCollection();
  syncViewUI();
  view.currentItemId = currentItemId;
  if (!isBoardView()) renderCardsView();
}

function renderCardsView() {
  const { scoped, visible } = controls.cardView.value;
  view.count = view.query
    ? tr("searchCount", { count: visible.length, unfinished: visible.filter(item => item.status !== "done").length })
    : tr("scopedCount", { count: scoped.length, unfinished: scoped.filter(item => item.status !== "done").length });
  view.empty = visible.length === 0;
  view.emptyTitle = items.length ? "noMatches" : "quiet";
  view.emptyHint = items.length ? "noMatchesHint" : "quietHint";
}

// ── 图板视图 ──────────────────────────────────────────────
// 一个类目 = 一张图板：封面由这个类目里最新几篇收藏的封面拼成（一张大的 + 两张小的），
// 下面是类目名、简介和篇数。点进去就是原来的卡片列表。
// 图板 = 全部项目总览。待整理 / 某个项目都是卡片列表，没有图板可看。
// 搜索时也让位给卡片列表：搜索要找的是「文章」，不是「类目」——所以只要搜索框里有字，
// 即便是「全部项目」也直接铺出命中的卡片（见 renderCardsView 里的全局搜索）。
function isBoardView() {
  return (view.activeProject === "all" || view.activeProject === "archive") && !view.query;
}

// 哪些控件在当前视图下该出现：排序和批量选择只对卡片列表有意义，
// 图板视图（全部项目）下收起它们。
function syncViewUI() {
  const board = isBoardView();
  view.board = board;
}

// Vue notifies after each committed batch, so positioning never races its DOM patch.
function cardsRendered(complete) {
  // 目标不在当前筛选结果中时，等批次完成便结束定位，不为定位强行切换筛选。
  if (!initialLocateItemId) return;
  const targetId = initialLocateItemId;
  if (findCard(targetId)) {
    initialLocateItemId = null;
    requestAnimationFrame(() => { if (targetId === currentItemId) locateCard(targetId); });
  } else if (complete) initialLocateItemId = null;
}

function findCard(id) {
  return grid.querySelector(`.card[data-id="${cssEscape(id)}"]`);
}

function locateCard(id) {
  const card = id && findCard(id);
  if (card && typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "center", behavior: "smooth" });
}

function selectProject(projectId, { asHome = false } = {}) {
  clearSearch();
  view.activeProject = normalizeProject(projectId);
  pageTitleMode = asHome ? "home" : "section";
  renderProjects();
  render();
  chrome.storage.local.set({ [ACTIVE_PROJECT_KEY]: view.activeProject });
}

function normalizeProject(projectId) {
  if (projectId === "archive" || projectId === "all" || projectId === "unfiled") return projectId;
  return projects.some((project) => project.id === projectId) ? projectId : "all";
}

// ── 项目置顶 ────────────────────────────────────────────────
// 置顶（project.pinned）的实现刻意做得很简单：**置顶的项目永远排在数组最前面**。
// 这样「存储里的顺序」就是「侧栏看到的顺序」，拖拽排序按屏幕算出来的下标可以直接用，
// 不用再做一次「显示顺序 ↔ 存储顺序」的换算（多一层换算就多一处会对不上的地方）。
function sortPinnedFirst(list) {
  const pinned = list.filter((project) => project.pinned);
  const rest = list.filter((project) => !project.pinned);
  return [...pinned, ...rest];
}

function renderProjects() {
  syncCollection();
  syncDocumentTitle();
}

async function openItemInNewTab(item) {
  const target = safeTarget(item.url);
  if (!target) { showToast(tr("invalidUrlShort")); return; }
  await chrome.tabs.create({ url: target, active: false, openerTabId: libraryTabId || undefined });
}

function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

// 在全屏收藏库里点一篇收藏：把「全屏」切换成「原文 + 侧栏」的阅读状态——
// 先在这个窗口打开侧栏（侧栏不会随页面跳转消失），再把收藏库自己这个标签页导航到原文。
// 想在新标签页里打开原文、让收藏库留着不动？按住 ⌘（Mac）/ Ctrl 再点即可。
async function openItem(event, item) {
  if (event.metaKey || event.ctrlKey) return;   // 修饰键 = 保留浏览器的默认行为
  event.preventDefault();

  const target = safeTarget(item.url);
  if (!target) { showToast(tr("invalidUrlShort")); return; }

  // 记下「正在读这篇」——侧栏据此高亮并滚动定位到它，两个视图保持一致。
  currentItemId = item.id;
  view.currentItemId = item.id;
  chrome.storage.local.set({ [CURRENT_ITEM_KEY]: item.id });

  const windowId = await resolveWindowId();
  const openTab = await globalThis.LaterOnTabs.findOpen(target, { excludeTabId: libraryTabId });
  const destinationWindowId = openTab?.windowId ?? windowId;
  if (!(await openSidePanel(destinationWindowId))) {
    // 侧栏打不开（极少数情况）：至少别让这次点击落空。
    showToast(tr("sidePanelFallback"));
    if (openTab) await globalThis.LaterOnTabs.activate(openTab);
    else await chrome.tabs.create({ url: target, openerTabId: libraryTabId || undefined });
    return;
  }

  // 等侧栏脚本就绪后再跳转，避免侧栏刚打开时读到「正在导航」的空页面；超时也照样跳。
  await waitForSidePanelReady(destinationWindowId);
  if (autoMarkRead && item.status === "unread") await controls.items.update(item.id, { status: "reading" });
  // 同一网页已经开着时直接回到它；不牺牲当前收藏库标签，也不制造重复页面。
  if (openTab) {
    await globalThis.LaterOnTabs.activate(openTab);
    return;
  }
  if (libraryTabId) await chrome.tabs.update(libraryTabId, { url: target });
  else await chrome.tabs.create({ url: target });
}

// 只放行 http/https，避免收藏里混进 javascript: 之类的地址。
function safeTarget(url) { return cardTarget(url); }

// 认准「收藏库自己在哪个窗口、哪个标签页」。用户可能把收藏库拖到别的窗口，
// 所以每次点击都重新问一次，而不是只信打开页面时缓存的值。
async function resolveWindowId() {
  const self = await chrome.tabs.getCurrent().catch(() => null);
  if (self?.id && self.windowId != null) {
    libraryTabId = self.id;
    libraryWindowId = self.windowId;
    return self.windowId;
  }
  const win = await chrome.windows.getCurrent().catch(() => null);
  if (win?.id != null) { libraryWindowId = win.id; return win.id; }
  return libraryWindowId;
}

// 打开浏览器侧栏。必须在用户点击的手势里调用，所以放在流程最前面。
async function openSidePanel(windowId) {
  if (typeof chrome.sidePanel?.open !== "function") return false;
  if (windowId != null) {
    try { await chrome.sidePanel.open({ windowId }); return true; } catch {}
  }
  // 缓存的窗口 id 过期时（比如刚把收藏库拖到另一个窗口）再刷新一次。
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId != null) { await chrome.sidePanel.open({ windowId: tab.windowId }); return true; }
  } catch {}
  return false;
}

async function waitForSidePanelReady(windowId) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "PING_SIDEPANEL", windowId });
      if (response?.ready) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return false;
}

// Browser/UI boundaries: typed modules own commands and consume their successful responses.
controls.commands.bind({ storage: LaterOnStorage, translate: tr, toast: showToast, navigate: selectProject,
  accept: (response) => {
    if (response.items) {
      items = normalizeItems(response.items);
      if (!items.some((item) => item.id === currentItemId)) currentItemId = null;
    }
    if (response.projects) projects = sortPinnedFirst(response.projects);
    if (response.covers) covers = response.covers;
    if (response.orders) orders = response.orders;
    render();
    renderProjects();
  },
  prompt: (config) => LaterOnDialog.prompt(config), confirm: (config) => LaterOnDialog.confirm(config),
  closeDialog: () => LaterOnDialog.close(),
  pick: (request) => window.openFolderPicker({ ...request, theme: settings.theme || "system",
    language: document.documentElement.lang, folders: projectPickerFolders(controls.collection.value, tr) }) });

controls.bulk.bind({ translate: tr, toast: showToast, mutate: controls.commands.mutate,
  confirm: controls.commands.confirm,
  pick: (request) => window.openFolderPicker({ ...request, theme: settings.theme || "system",
    language: document.documentElement.lang, folders: projectPickerFolders(controls.collection.value, tr),
    onCreateProject: (name) => request.current() ? controls.projects.createFromPicker(name) : null }),
  openWindow: (url) => chrome.windows.create({ url: [...url], focused: true, type: "normal" }) });

controls.bind({ filter: setFilter, search: render, sort: () => { render(); saveSortSetting(); }, home: goHome,
  project: selectProject, settings: openSettings, cardsRendered,
  openItem: async (id) => { const item = items.find((entry) => entry.id === id); if (item) await openItemInNewTab(item); } });
let toastTimer = null;
let toastGeneration = 0;
function showToast(message, duration = 1800, variant = "") {
  const generation = ++toastGeneration;
  toast.classList.toggle("pill-toast", variant === "pill");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (generation !== toastGeneration) return;
    toast.classList.remove("show");
    // 等退出动画播完再卸掉药丸变体，避免元素在淡出途中突然跳回右下角。
    setTimeout(() => {
      if (generation === toastGeneration) toast.classList.remove("pill-toast");
    }, 260);
  }, duration);
}

}
