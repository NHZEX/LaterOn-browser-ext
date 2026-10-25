import { nextTick } from "vue";
import { normalizeFilter, normalizeSort } from "./src/collection/filter";
import { projectPickerFolders, cardTarget } from "./src/library/shared";

// Vue owns rendering and collection commands; this transitional controller retains drag, navigation and page adapters.
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
let dragPreview = null;
// 当前这次拖拽的全部状态（null = 现在没在拖）。卡片视图和图板视图共用同一套逻辑，
// 区别只有「拖的是什么、松手后写到哪儿」，都记在这个对象里：
//   container / selector / idAttr —— 在哪个容器里拖哪些元素、元素的 id 记在哪个 data 属性上
//   id —— 正在拖的这个的 id
//   layout —— 拖动开始那一刻拍的布局快照（整段拖动都用它，绝不重新读真实位置）
//   slot —— 当前算出的插入位置（用来判断要不要重排，避免抖动）
let drag = null;
let dragHomeFrame = null;   // 原位置留下的那个空虚线框（绝对定位浮层，不占格子）
let folderDragId = null;      // 正在拖拽排序的项目 id（null = 当前没在拖）
let currentItemId = null;     // 当前正在读的文章 id（来自 CURRENT_ITEM_KEY，两个视图共享）
// 从侧栏展开全屏时，等目标卡片真正分批渲染出来后再滚过去；普通打开首页不定位。
let initialLocateItemId = null;
let covers = {};              // 用户上传的封面：{ 收藏 id: dataURL }（与 COVERS_KEY 对应）
let folderDragPreview = null; // 跟着光标走的拖拽影像（行本身是透明的，要做一份实体化的）
let folderDropLine = null;    // 列表里那条「会插到这里」的指示线
let folderDragBlocked = false; // 这次按下是从「改名输入框 / ⋯ 按钮」上开始的，不能当拖拽

const grid = document.querySelector("#cardGrid");
const boardGrid = document.querySelector("#boardGrid");
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
  initSidebarResize(result[SIDEBAR_WIDTH_KEY]);
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

function initSidebarResize(savedWidth) {
  const workspace = document.querySelector(".workspace");
  const handle = document.querySelector("#sidebarResizer");
  const controls = document.querySelector("#sidebarSizeControls");
  if (!workspace || !handle || !controls) return;
  const minWidth = 240;
  const defaultWidth = 280;
  const maxWidth = 420;
  const normalizeWidth = (value) => typeof value === "number" && Number.isFinite(value)
    ? Math.max(minWidth, Math.min(maxWidth, Math.round(value))) : defaultWidth;
  let preferredWidth = normalizeWidth(savedWidth);
  let resizing = null;
  let ignoreClick = false;

  const applyWidth = (value) => {
    // Narrow windows keep at least 360px for content; retain the preferred width for later.
    const available = workspace.clientWidth || window.innerWidth;
    const limit = Math.max(minWidth, Math.min(maxWidth, available - 360));
    const width = Math.min(normalizeWidth(value), limit);
    workspace.style.setProperty("--sidebar-width", `${width}px`);
    handle.setAttribute("aria-valuemin", String(minWidth));
    handle.setAttribute("aria-valuemax", String(limit));
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuetext", tr("sidebarWidth", { n: width }));
    return width;
  };
  const currentWidth = () => Number(handle.getAttribute("aria-valuenow"));
  const saveWidth = (value) => {
    preferredWidth = applyWidth(value);
    chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: preferredWidth }).catch(() => {});
  };
  const finishResize = (cancelled = false) => {
    if (!resizing) return;
    const { pointerId, moved } = resizing;
    resizing = null;
    document.body.classList.remove("is-resizing-sidebar");
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    ignoreClick = moved;
    if (cancelled) applyWidth(preferredWidth);
    else if (moved) saveWidth(currentWidth());
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false || window.innerWidth <= 620 || resizing) return;
    event.preventDefault();
    ignoreClick = false;
    controls.hidden = true;
    handle.focus({ preventScroll: true });
    resizing = { pointerId: event.pointerId, x: event.clientX, width: currentWidth(), moved: false };
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-resizing-sidebar");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!resizing || event.pointerId !== resizing.pointerId) return;
    const delta = event.clientX - resizing.x;
    if (!resizing.moved && Math.abs(delta) < 3) return;
    resizing.moved = true;
    applyWidth(resizing.width + delta);
  });
  handle.addEventListener("pointerup", (event) => {
    if (event.pointerId === resizing?.pointerId) finishResize();
  });
  handle.addEventListener("pointercancel", () => finishResize(true));
  handle.addEventListener("lostpointercapture", () => finishResize(true));
  handle.addEventListener("click", () => {
    if (ignoreClick) { ignoreClick = false; return; }
    controls.hidden = !controls.hidden;
  });
  handle.addEventListener("dblclick", () => {
    controls.hidden = true;
    saveWidth(defaultWidth);
  });
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 8;
    const widths = { ArrowLeft: currentWidth() - step, ArrowRight: currentWidth() + step,
      Home: minWidth, End: maxWidth, Enter: defaultWidth };
    if (Object.hasOwn(widths, event.key)) {
      event.preventDefault();
      if (!resizing) saveWidth(widths[event.key]);
    } else if (event.key === " ") {
      event.preventDefault();
      controls.hidden = !controls.hidden;
    }
  });
  controls.addEventListener("click", (event) => {
    const action = event.target.closest("[data-sidebar-size]")?.dataset.sidebarSize;
    if (!action) return;
    const widths = { narrower: currentWidth() - 24, wider: currentWidth() + 24, reset: defaultWidth };
    saveWidth(widths[action]);
  });
  document.addEventListener("click", (event) => {
    if (!controls.contains(event.target) && !handle.contains(event.target)) controls.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    finishResize(true);
    if (controls.contains(document.activeElement)) handle.focus({ preventScroll: true });
    controls.hidden = true;
  });
  window.addEventListener("blur", () => finishResize(true));
  window.addEventListener("resize", () => {
    finishResize(true);
    controls.hidden = true;
    applyWidth(preferredWidth);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SIDEBAR_WIDTH_KEY] || resizing) return;
    preferredWidth = normalizeWidth(changes[SIDEBAR_WIDTH_KEY].newValue);
    applyWidth(preferredWidth);
  });
  window.addEventListener("lateron-language-change", () => applyWidth(preferredWidth));
  applyWidth(preferredWidth);
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

// ── 拖拽排序（卡片视图和图板视图共用同一套）─────────────────
// 把一个元素拖到另一个元素上：插到它前面（光标落在左半边）或后面（右半边），
// 松手就把这个顺序存下来。
//
// ⚠️ 关键：拖动过程中**绝对不能改 DOM、也不能重新读元素位置**。
// 老做法是「在落点插入一个占格的空位 + 把被拖的元素 display:none」，
// 这会立刻让所有元素重新排布；下一次 dragover 再按新位置判定，
// 鼠标底下就换成了另一个 → 又插一次 → 两个来回互换，看着就是疯狂跳动
// （叠加 FLIP 动画后更糟：动画期间 getBoundingClientRect 读到的是中间值）。
// 现在改成：布局只在拖动开始时拍一次快照，之后判定用快照、让位用 transform。
//
// 参数：container 在哪个容器里拖 / selector 被拖的元素 / idAttr 元素上记 id 的
// data 属性名（"id" → data-id、"project" → data-project）/ commit 松手时怎么存。
function enableReorder({ container, selector, idAttr, commit, dragImageHotspotX = null }) {
  container.addEventListener("dragstart", (event) => {
    const el = event.target.closest(selector);
    if (!el) return;
    // 拖拽是另一种明确操作：离开多选状态，避免拖动后仍保留旧的勾选。
    controls.selection.set(false);
    // 从按钮 / 下拉上按下的是想点它，不是想拖整块（图板上那个改简介的铅笔就是）。
    if (event.target.closest("button, select")) { event.preventDefault(); return; }
    const id = el.dataset[idAttr];
    if (!id) return;
    drag = { container, selector, idAttr, id, layout: null, slot: null };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
    const bounds = el.getBoundingClientRect();
    dragPreview = el.cloneNode(true);
    dragPreview.removeAttribute("draggable");
    dragPreview.classList.remove("dragging");
    dragPreview.classList.add("drag-preview");
    dragPreview.style.width = `${bounds.width}px`;
    dragPreview.style.height = `${bounds.height}px`;
    document.body.append(dragPreview);
    const grabbedOffsetX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    // 收藏卡片拖向左侧项目时，用卡片左边缘作为横向触发基准：拖影的光标热点
    // 固定在左边缘附近后，左边缘刚碰到项目行，真实指针也就进入了放置区。
    // 纵向仍保留用户原本抓住的位置，避免目标项目上下错位。
    const offsetX = Number.isFinite(dragImageHotspotX)
      ? Math.max(0, Math.min(bounds.width, dragImageHotspotX))
      : grabbedOffsetX;
    const offsetY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    event.dataTransfer?.setDragImage?.(dragPreview, offsetX, offsetY);
    // 快照要在 setDragImage 之后拍，并且此时元素还没加 .dragging（那个类会改变外观）。
    drag.layout = snapshotLayout(container, selector, idAttr);
    showDragHomeFrame();
    container.classList.add("is-reordering");
    const session = drag;
    requestAnimationFrame(() => { if (drag === session) el.classList.add("dragging"); });
  });
  container.addEventListener("dragend", endReorder);
  container.addEventListener("dragover", (event) => {
    if (!drag || drag.container !== container || !drag.layout) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const index = insertionIndexAt(
      (Number.isFinite(event.clientX) ? event.clientX : 0) + window.scrollX,
      (Number.isFinite(event.clientY) ? event.clientY : 0) + window.scrollY
    );
    if (index === drag.slot) return;   // 位置没变就什么都不做，这是不抖动的第一道保险
    drag.slot = index;
    applyReorderPreview(index);
  });
  container.addEventListener("drop", (event) => {
    if (!drag || drag.container !== container) return;
    event.preventDefault();
    // 直接用最后一次算好的位置：松手时光标可能正好停在缝隙里，重新判定反而容易算偏。
    const index = drag.slot ?? insertionIndexAt(
      (Number.isFinite(event.clientX) ? event.clientX : 0) + window.scrollX,
      (Number.isFinite(event.clientY) ? event.clientY : 0) + window.scrollY
    );
    commit(index).catch(() => {});
  });
}

function endReorder() {
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  dragPreview?.remove();
  dragPreview = null;
  // 先收再清：clearReorderPreview 要靠 drag 去找容器和快照，
  // 所以「置空」必须排在它后面（拖到别处或按 Esc 取消不会触发 drop，这里兜底）。
  clearReorderPreview();
  drag = null;
  clearDropHighlights();
}

// 卡片：拖一张卡片到另一个位置 → 换阅读顺序（每个项目各存一份，互不影响）。
enableReorder({ container: grid, selector: ".card", idAttr: "id", commit: commitCardOrder, dragImageHotspotX: 8 });
// 图板：拖一块图板 → 换这个类目在图板墙上的位置。和拖卡片是同一套手感。
enableReorder({ container: boardGrid, selector: ".board-card", idAttr: "project", commit: commitBoardOrder });

// 拖动开始时拍一张布局快照：记下每个元素当时占的是第几个格子、格子在哪。
// 坐标存成文档坐标（加上滚动量），这样拖动中页面万一滚动了也不会算歪。
function snapshotLayout(container, selector, idAttr) {
  const elements = [...container.querySelectorAll(selector)];
  return {
    ids: elements.map((el) => el.dataset[idAttr]),
    rects: elements.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left + window.scrollX, top: rect.top + window.scrollY,
        right: rect.right + window.scrollX, bottom: rect.bottom + window.scrollY,
        width: rect.width, height: rect.height
      };
    })
  };
}

// 原位置留下的空虚线框：一块被拖走后，它原来的格子不应该空得没影，
// 而是显示一个虚线框占住「这里是它的老家」。
// 实现成绝对定位的浮层（不占网格格子）→ 不会让任何元素重新排布，
// 也就不会重新引发「插占格元素 → 位置全变 → 判定错乱」的抖动问题。
// 位置取自拖动开始时的快照（老家的格子全程不动），所以只需要算一次。
function showDragHomeFrame() {
  if (!drag?.layout) return;
  const fromIdx = drag.layout.ids.indexOf(drag.id);
  if (fromIdx === -1) return;
  const rect = drag.layout.rects[fromIdx];
  const container = drag.container;
  const box = container.getBoundingClientRect();
  if (!dragHomeFrame) {
    dragHomeFrame = document.createElement("div");
    dragHomeFrame.className = "drag-home-frame";
    dragHomeFrame.setAttribute("aria-hidden", "true");
  }
  container.append(dragHomeFrame);
  // 快照是文档坐标，浮层相对容器定位：先减掉滚动量换回视口坐标，再减掉容器自己的偏移。
  dragHomeFrame.style.width = `${rect.width}px`;
  dragHomeFrame.style.height = `${rect.height}px`;
  dragHomeFrame.style.left = `${rect.left - window.scrollX - box.left}px`;
  dragHomeFrame.style.top = `${rect.top - window.scrollY - box.top}px`;
}

function clearDragHomeFrame() {
  dragHomeFrame?.remove();
  dragHomeFrame = null;
}

// 光标现在的位置，应该插到第几个「不含被拖那个」的元素前面（0 = 最前面）。
// 判定用的是拖动开始时的快照坐标，所以元素怎么让开都不会反过来影响判定。
function insertionIndexAt(x, y) {
  if (!drag?.layout) return 0;
  const { ids, rects } = drag.layout;
  const fromIdx = ids.indexOf(drag.id);
  for (let k = 0; k < ids.length; k += 1) {
    if (k === fromIdx) continue;          // 自己原来那个格子不算目标
    const rect = rects[k];
    if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) {
      // 落在左半边 = 插到它前面；右半边 = 插到它后面。
      const restIndex = k < fromIdx ? k : k - 1;
      return x >= rect.left + rect.width / 2 ? restIndex + 1 : restIndex;
    }
  }
  // 没压在任何元素上（格子之间的缝隙）：维持上一次的结果。
  // 这是不抖动的第二道保险——否则光标一进缝隙，所有元素就会让开又挤回来。
  if (drag.slot !== null) return drag.slot;
  return rects.length && y < rects[0].top ? 0 : ids.length - 1;
}

// 让位：不动 DOM，只把每个元素平移到「插进去之后它该在的格子」。
// .card / .board-card 本身都带 transform 过渡，所以这一步看起来就是其它元素平滑地
// 让开一格，被拖的那个也会滑到落点。松手会落在哪，拖的时候看得清清楚楚。
function applyReorderPreview(index) {
  if (!drag?.layout) return;
  const { ids, rects } = drag.layout;
  const fromIdx = ids.indexOf(drag.id);
  if (fromIdx === -1) return;
  for (let i = 0; i < ids.length; i += 1) {
    const el = drag.container.querySelector(`[data-${drag.idAttr}="${ids[i]}"]`);
    if (!el) continue;
    // 第 i 个元素原来就占第 i 个格子，算出插完后它该去哪个格子。
    let target;
    if (i === fromIdx) {
      target = index;                     // 被拖的那个：直接滑到落点
    } else {
      const restIndex = i < fromIdx ? i : i - 1;
      target = restIndex < index ? restIndex : restIndex + 1;
    }
    const dx = rects[target].left - rects[i].left;
    const dy = rects[target].top - rects[i].top;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

// 收起让位效果：把预览用的 transform 全部抹掉，并收掉老家的虚线框。
function clearReorderPreview() {
  if (drag?.layout) {
    for (const id of drag.layout.ids) {
      const el = drag.container.querySelector(`[data-${drag.idAttr}="${id}"]`);
      if (el) el.style.transform = "";
    }
  }
  // 快照也一起丢掉：松手后如果又来一次 dragover（drop 和 dragend 之间有可能），
  // 没有快照它就会直接返回，不会拿旧坐标去动已经重排好的 DOM。
  if (drag) { drag.slot = null; drag.layout = null; }
  clearDragHomeFrame();
  drag?.container.classList.remove("is-reordering");
}

// 把拖拽结果写成新的顺序存起来。
// 注意存的是「这个范围里所有收藏」的顺序，不只是眼前筛出来的这几张——
// 否则在「未读」筛选下拖一次，被筛掉的「已读」就会丢掉自己的位置。
async function commitCardOrder(dropIndex) {
  const draggedId = drag?.id;
  if (!draggedId || dropIndex == null) return;
  // 屏幕上现在这个顺序里，被拖的这张应该排到谁前面（null = 排最后）。
  const visibleIds = [...grid.querySelectorAll(".card")]
    .map((card) => card.dataset.id)
    .filter((id) => id && id !== draggedId);
  const anchorId = visibleIds[dropIndex] ?? null;

  const response = await LaterOnStorage.run("moveItem", { id: draggedId, scope: orderScope(), beforeId: anchorId });
  orders = response.orders;

  // 存好之后再收起让位效果。顺序很讲究：先关掉过渡，再抹掉预览用的 transform，
  // 然后 render() 按新顺序排好——三步在同一帧内完成，所以卡片直接从「让开的样子」
  // 落到最终位置，不会先弹回原位再跳过去（那一下就是以前看起来「乱跳」的观感）。
  grid.classList.add("no-transition");
  clearReorderPreview();
  // 原来不是「自定义顺序」的话，拖这一次就说明你想自己排，顺手切过去并说一声。
  if (view.sort !== "custom") {
    view.sort = "custom";
    render();
    saveSortSetting();
    showToast(tr("customSortEnabled"));
  } else {
    render();
    showToast(tr("orderSaved"));
  }
  await nextTick();
  void grid.offsetHeight;   // 强制回流，让新位置立刻生效，再恢复过渡
  grid.classList.remove("no-transition");
}

// ── 图板排序 ────────────────────────────────────────────
// 图板的顺序 = 项目的顺序（存在 PROJECTS_KEY，和侧栏项目列表是同一份）。
// 这样只有一份真相：拖图板会同步改侧栏，在侧栏拖项目也会同步改图板。
// 注意：图板上只有项目，「待整理」不占一块（见 boardGroups）。
function boardOrderIds() {
  return projects.map((project) => project.id);
}

async function commitBoardOrder(dropIndex) {
  const draggedId = drag?.id;
  if (!draggedId || dropIndex == null) return;
  // 和卡片一样：拿屏幕上现在这个顺序里「要排在谁前面」当锚点，
  // 再换算回完整顺序里——搜索/筛选藏起来的那些类目才不会被挤走。
  const visibleIds = [...boardGrid.querySelectorAll(".board-card")]
    .map((card) => card.dataset.project)
    .filter((id) => id && id !== draggedId);
  const anchorId = visibleIds[dropIndex] ?? null;
  const full = boardOrderIds().filter((id) => id !== draggedId);
  const at = anchorId ? full.indexOf(anchorId) : -1;
  const next = at === -1 ? [...full, draggedId] : [...full.slice(0, at), draggedId, ...full.slice(at)];

  if (next.every((id, i) => id === projects[i]?.id)) return;

  const name = projects.find((project) => project.id === draggedId)?.name || tr("unnamedProject");
  const response = await LaterOnStorage.run("moveProject", { id: draggedId, beforeId: anchorId });
  boardGrid.classList.add("no-transition");
  clearReorderPreview();
  projects = response.projects;
  render();
  renderProjects();   // 侧栏的项目列表跟着换，两边顺序始终一致
  showToast(tr("movedToPosition", { name, n: projects.findIndex((project) => project.id === draggedId) + 1 }));
  void boardGrid.offsetHeight;
  boardGrid.classList.remove("no-transition");
}

// ── 项目排序的接线（委托到稳定容器，行由 Vue 管理）──────────
const projectListEl = document.querySelector("#projectList");
projectListEl.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".project-row");
  if (row) startFolderDrag(event, row.dataset.id, row);
});
projectListEl.addEventListener("dragend", endFolderDrag);
projectListEl.addEventListener("pointerdown", (event) => {
  // 记下这次按压是不是从「改名输入框 / ⋯ 按钮」上开始的，
  // 因为拖拽事件的 target 是整行，读不出内层元素。
  folderDragBlocked = !!event.target?.closest?.(".project-rename, .project-more");
});
projectListEl.addEventListener("dragover", (event) => {
  if (!folderDragId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  moveFolderDropLine(Number.isFinite(event.clientY) ? event.clientY : 0);
});
projectListEl.addEventListener("drop", (event) => {
  if (!folderDragId) return;
  event.preventDefault();
  commitFolderOrder().catch(() => {});
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

// 当前在看哪个范围：全部项目 / 待整理 / 某个项目。自定义顺序按范围各存一份。
function orderScope() {
  return view.activeProject || "all";
}

function syncCollection() {
  // Remove temporary drag nodes before Vue reconciles its keyed rows and boards.
  if (folderDragId) endFolderDrag();
  if (drag) endReorder();
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

// Stable-container delegation keeps legacy drag mechanics independent of Vue row creation.
const sidebar = document.querySelector("#projectSidebar");
function itemDropTarget(event) {
  if (isFolderDrag(event)) return null;
  return event.target.closest(".project-row, .inbox-card");
}
sidebar.addEventListener("dragover", (event) => {
  const target = itemDropTarget(event);
  if (!target) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  clearDropHighlights();
  target.classList.add("drop-target");
});
sidebar.addEventListener("dragleave", (event) => {
  const target = itemDropTarget(event);
  if (target && !target.contains(event.relatedTarget)) target.classList.remove("drop-target");
});
sidebar.addEventListener("drop", async (event) => {
  const target = itemDropTarget(event);
  if (!target) return;
  event.preventDefault();
  const itemId = event.dataTransfer?.getData("text/plain");
  const projectId = target.dataset.project === "unfiled" ? null : target.dataset.project;
  const projectName = projectId ? projects.find(project => project.id === projectId)?.name : tr("inbox");
  clearDropHighlights();
  if (!itemId || !items.some(item => item.id === itemId)) return;
  if (!await controls.items.update(itemId, { projectId })) return;
  showToast(tr("movedIntoProject", { name: projectName || tr("genericProject") }));
});

function clearDropHighlights() {
  document.querySelectorAll(".drop-target").forEach((element) => element.classList.remove("drop-target"));
}

// ── 项目排序：按住项目行上下拖，换它在侧栏里的位置 ──────────
// 拖拽用自定义数据类型标记，和「拖收藏卡片进项目」共用一个放下的区域，
// 靠 isFolderDrag() 区分——否则拖项目会被当成「把某篇收藏移进来」。
const FOLDER_DRAG_TYPE = "application/x-lateron-folder";

function isFolderDrag(event) {
  const types = event?.dataTransfer?.types;
  return !!types && Array.from(types).includes(FOLDER_DRAG_TYPE);
}

function startFolderDrag(event, projectId, row) {
  // 从改名输入框或「⋯」按钮上按下的，交给它们自己处理（选文字 / 开菜单）。
  if (folderDragBlocked || view.renamingId) {
    event.preventDefault();
    return;
  }
  folderDragId = projectId;
  const transfer = event.dataTransfer;
  if (transfer) {
    transfer.effectAllowed = "move";
    try { transfer.setData(FOLDER_DRAG_TYPE, projectId); } catch {}
    if (typeof transfer.setDragImage === "function") {
      // 行本身是透明底，直接用它当拖拽影像会糊；克隆一份实体化的贴在光标上。
      const bounds = row.getBoundingClientRect();
      folderDragPreview = row.cloneNode(true);
      folderDragPreview.removeAttribute("draggable");
      folderDragPreview.classList.remove("is-dragging");
      folderDragPreview.classList.add("folder-drag-preview");
      folderDragPreview.style.width = `${bounds.width || 180}px`;
      document.body.append(folderDragPreview);
      const point = (value, size) => (Number.isFinite(value) ? Math.max(0, Math.min(size, value)) : 0);
      transfer.setDragImage(
        folderDragPreview,
        point(event.clientX - bounds.left, bounds.width || 180),
        point(event.clientY - bounds.top, bounds.height || 36)
      );
    }
  }
  row.classList.add("is-dragging");
  document.querySelector("#projectList")?.classList.add("is-sorting");
}

// 按指针纵向位置，把指示线插到「应该插进去的那两行之间」。
function moveFolderDropLine(pointerY) {
  const projectList = document.querySelector("#projectList");
  if (!projectList || !folderDragId) return;
  const rows = [...projectList.children].filter((element) => element.classList.contains("project-row"));
  let target = null;
  for (const row of rows) {
    if (row.dataset.id === folderDragId) continue; // 被拖的那行不参与比较
    const bounds = row.getBoundingClientRect();
    if (pointerY < bounds.top + bounds.height / 2) { target = row; break; }
  }
  // 先把「插到哪一行前面」换成下标（去掉被拖那项后，它前面还有几行），
  // 夹到允许区间里，再换回行对象——这样指示线本身也只在合法的落点上出现，
  // 用户看到的「会插到这里」和松手后的结果永远一致。
  const others = rows.filter((row) => row.dataset.id !== folderDragId);
  const index = target ? rows.slice(0, rows.indexOf(target)).filter((row) => row.dataset.id !== folderDragId).length : others.length;
  const [min, max] = folderDropRange();
  const before = others[Math.max(min, Math.min(max, index))] || null;
  if (!folderDropLine) {
    folderDropLine = document.createElement("div");
    folderDropLine.className = "folder-drop-line";
  }
  if (folderDropLine.nextSibling === before && folderDropLine.parentNode === projectList) return;
  projectList.insertBefore(folderDropLine, before); // before 为 null 时自动插到末尾
}

// 指示线上面有几行（不算被拖的那行）= 它在新顺序里该待的下标。
function folderDropIndex() {
  const projectList = document.querySelector("#projectList");
  if (!projectList || !folderDropLine?.parentNode) return null;
  const children = [...projectList.children];
  const lineAt = children.indexOf(folderDropLine);
  if (lineAt < 0) return null;
  return children
    .slice(0, lineAt)
    .filter((element) => element.classList.contains("project-row") && element.dataset.id !== folderDragId)
    .length;
}

async function commitFolderOrder() {
  const index = folderDropIndex();
  const dragged = projects.find((project) => project.id === folderDragId);
  if (index == null || !dragged) return;
  const visible = projects.filter((project) => !project.archived);
  const rest = visible.filter((project) => project.id !== dragged.id);
  const [min, max] = folderDropRange();
  const at = Math.max(min, Math.min(max, index));
  if (visible.indexOf(dragged) === at) return;
  const response = await LaterOnStorage.run("moveProject", { id: dragged.id, beforeId: rest[at]?.id ?? null });
  projects = response.projects;
  renderProjects();
  showToast(tr("movedToPosition", { name: dragged.name, n: projects.findIndex((project) => project.id === dragged.id) + 1 }));
}

// 拖拽排序只在「自己那一区」里发生：置顶的项目只能在置顶那几个之间换位，
// 普通项目只能在其余项目里换位。想把项目挪进 / 挪出置顶区请用右键菜单里的
// 「置顶项目 / 取消置顶」——拖动的时候悄悄改掉置顶状态，会让「拖到第 1 个」
// 这种动作的结果变得不可预测（拖上去就变成置顶，再拖下来就丢掉置顶）。
// 返回值是允许的下标区间 [最小, 最大]，下标按「去掉被拖的那项之后」的列表算。
function folderDropRange() {
  const rest = projects.filter((project) => !project.archived && project.id !== folderDragId);
  const pins = rest.filter((project) => project.pinned).length;
  const dragged = projects.find((project) => project.id === folderDragId);
  return dragged?.pinned ? [0, pins] : [pins, rest.length];
}

function endFolderDrag() {
  folderDragId = null;
  folderDragBlocked = false;
  folderDropLine?.remove();
  folderDropLine = null;
  folderDragPreview?.remove();
  folderDragPreview = null;
  document.querySelectorAll(".project-row.is-dragging").forEach((row) => row.classList.remove("is-dragging"));
  document.querySelector("#projectList")?.classList.remove("is-sorting");
  clearDropHighlights();
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
