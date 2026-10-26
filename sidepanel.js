import { normalizeFilter } from "./src/collection/filter";
import { normalizePanelProject } from "./src/sidepanel/shared";
import { nextCoverFallback } from "./src/shared/card-media";
import { sortCollectionItems } from "./src/shared/collection-sort";

// E3 过渡控制器：仅保留启动、缓存、当前网页与浏览器生命周期；卡片交互由 Vue 拥有。
export function startSidepanelPage(controls, commands) {
let alive = true;
const cleanups = [];
const timers = new Set();
const setTimeout = (fn, ms) => {
  const id = window.setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
  timers.add(id);
  return id;
};
const clearTimeout = (id) => { timers.delete(id); window.clearTimeout(id); };
function listen(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  cleanups.push(() => target.removeEventListener(event, handler, options));
}
function listenChrome(event, handler) {
  event.addListener(handler);
  cleanups.push(() => event.removeListener?.(handler));
}
controls.connect(render, hideBootPlaceholder);
commands.bind({
  accept(response) {
    if (!alive) return;
    if (response.items) items = normalizeItems(response.items);
    if (response.covers) covers = response.covers;
    if (response.orders) orders = response.orders;
    if (currentItemId && !items.some(item => item.id === currentItemId)) {
      currentItemId = null;
      applyCurrentAndLocate();
    }
    render();
  },
  customSort() { sortMode = "custom"; render(); },
  setCurrent(id) { currentItemId = id; applyCurrentAndLocate(); }
});
const STORAGE_KEY = "laterOnItems";
const PROJECTS_KEY = "laterOnProjects";
const ACTIVE_PROJECT_KEY = "laterOnActiveProject";
const SETTINGS_KEY = "laterOnSettings";
const tr = (key, vars) => window.LaterOnI18n?.t(key, vars) || key;
// 与全屏界面共享的「当前正在读哪篇」标记（全屏实现见 src/library/useLibraryReader.ts）。
const CURRENT_ITEM_KEY = "laterOnCurrentItem";
// 与全屏界面共享的「当前筛到哪一档」（全部 / 未读 / 已读）：一边切，另一边跟着切。
const FILTER_KEY = "laterOnFilter";
const FILTER_CHOSEN_KEY = "laterOnFilterChosen";
const DEFAULT_FILTER = "unread";
// 与全屏界面共享的「自定义顺序」：全屏拖出来的阅读顺序，侧栏照着排。
const ORDER_KEY = "laterOnOrder";
// 用户自己上传的封面（体积大）：单独放一个键，不和收藏列表混在一个数组里。
// 否则每次读写列表都要「连图一起搬」，数据攒多了侧栏打开就会卡很久。
const COVERS_KEY = "laterOnCovers";
// 侧栏「秒开」缓存：把上一回的收藏列表快照存进本页的 localStorage（同步可读）。
// 打开侧栏时先画缓存，再去 chrome.storage 拿最新数据核对——就算存储读取慢，
// 界面也不会白屏干等。
const CACHE_KEY = "laterOnPanelCache";
// 本机 localStorage 是不是本身就慢（第一次读就超过 0.4 秒即判定）。
// 慢的话就彻底不再碰它：秒开快照靠不住，反复读写反而一次比一次拖。
let localStorageSlow = false;
let cacheSaveTimer = null;
let sidePanelWindowId = null;
let sidePanelReady = false;

// 侧栏自己所在窗口的 id 是异步取的（`chrome.windows.getCurrent()`），
// 而完整界面的握手请求可能比它先到。把这次查询存成 Promise，
// 收到握手时等它就绪再回答，避免完整界面白白等到超时。
const windowIdReady = chrome.windows.getCurrent().then(
  (windowInfo) => { sidePanelWindowId = windowInfo.id; return windowInfo.id; },
  () => null
);

// 完整界面会等待这个握手完成，再将当前标签页跳转到文章。
listenChrome(chrome.runtime.onMessage, (message, _sender, sendResponse) => {
  if (message.type !== "PING_SIDEPANEL") return;
  windowIdReady.then((id) => sendResponse({ ready: sidePanelReady && id === message.windowId }));
  return true;   // 异步应答
});

let items = [];
let projects = [];
let archivedProjectIds = new Set();
let currentItem = null;
const scope = controls.state;
let sortMode = "newest";   // 与全屏共享四档排序偏好
let orders = {};           // 用户拖出来的自定义顺序（与全屏共享：{ 范围: [收藏 id] }）
let covers = {};           // 用户上传的封面：{ 收藏 id: dataURL }（与 COVERS_KEY 对应）
let loadGeneration = 0;
let currentItemId = null;     // 当前正在读的文章 id（与全屏界面共享，用于高亮 + 滚动定位）
// 秒开缓存只为第一屏服务，不是第二份完整数据库。存得越大，localStorage 冷读和
// JSON.parse 越慢；真实完整列表随后仍会由 chrome.storage.local 校准。
const CACHE_PREVIEW_LIMIT = 12;
const frames = new Set();
const nextFrame = (fn) => {
  if (typeof window.requestAnimationFrame !== "function") { setTimeout(fn, 16); return; }
  const id = window.requestAnimationFrame(() => { frames.delete(id); if (alive) fn(); });
  frames.add(id);
};
const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
const saveButton = document.querySelector("#saveCurrent");
const status = document.querySelector("#status");

// 先让浏览器完成一帧绘制骨架屏，再启动数据读取和真实列表渲染。
// 如果这里直接同步 init()，首屏缓存很快时骨架会在第一次 paint 前就被移除，
// 用户只会看到“突然出现的正式内容”，看不到正在加载的反馈。
if (typeof requestAnimationFrame === "function") {
  nextFrame(() => nextFrame(() => init()));
} else {
  setTimeout(() => init(), 16);
}

// 页面里加载最慢的几个文件（CSS / JS）。慢在「读页面」还是「读数据」，看这个就知道。
function slowestResources() {
  try {
    const entries = (typeof performance !== "undefined" && performance.getEntriesByType)
      ? performance.getEntriesByType("resource")
      : [];
    return entries
      .filter((entry) => typeof entry.duration === "number" && entry.duration > 150)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3)
      .map((entry) => ({
        name: String(entry.name).split("/").pop() || String(entry.name),
        ms: Math.round(entry.duration)
      }));
  } catch {
    return [];
  }
}

// 各段的中文名：横幅 / 诊断里都用它，顺序就是显示顺序。
const bootSegments = () => [
  ["page", tr("segPage")], ["cache", tr("segCache")], ["paint", tr("segPaint")],
  ["data", tr("segData")], ["migrate", tr("segMigrate")], ["other", tr("segOther")]
];

// 慢在哪一段 → 一句话结论（写给人看，不写术语）。
function slowConclusion(seg) {
  const worst = bootSegments()
    .filter(([key]) => (seg[key] || 0) > 0)
    .sort((a, b) => (seg[b[0]] || 0) - (seg[a[0]] || 0))[0];
  if (!worst) return "";
  const [key, label] = worst;
  const ms = seg[key];
  if (document.documentElement.lang === "en") {
    if (key === "page") return "Most time was spent preparing the page — Chrome was opening the side panel or loading its files; the number of saves isn’t the cause.";
    if (key === "cache") return `The local snapshot took ${ms} ms to read, so it will be skipped for the rest of this session.`;
    if (key === "data") return `Reading local storage took ${ms} ms. The cached first screen was shown while it finished.`;
    if (key === "paint") return `Painting the first screen took ${ms} ms. Remaining cards are being rendered in batches.`;
    if (key === "migrate") return `Migrating old covers took ${ms} ms. This should only happen once after upgrading.`;
    return `Finishing up took ${ms} ms.`;
  }
  if (key === "page") return "「准备页面」占了大头 → 是 Chrome 打开侧边栏 / 加载页面文件慢，跟添加的网页数量无关。";
  if (key === "cache") return `「读本地缓存」占了大头（${ms} 毫秒）→ 侧栏的秒开快照读取慢，接下来本次会话会直接跳过它，不再反复卡。`;
  if (key === "data") return `「读取网页数据」占了大头（${ms} 毫秒）→ 本地存储冷的时候这一次读取会慢，列表已先用缓存画出来了。`;
  if (key === "paint") return `「画第一屏」占了大头（${ms} 毫秒）→ 卡片太多，一次画不完（已分批，剩下的后台续画）。`;
  if (key === "migrate") return `「整理旧封面」占了大头（${ms} 毫秒）→ 升级后第一次打开会搬一次封面，之后不会再有。`;
  return `其余收尾花了 ${ms} 毫秒。`;
}

// 把「慢在哪一步」直接写在侧栏顶部：不用去设置页翻，也不用盯着转瞬即逝的提示。
function showSlowBanner({ total, firstPaint, seg, slow }) {
  const banner = document.querySelector("#slowBanner");
  if (!banner) return;
  // 只列出真正花掉时间的段（<80 毫秒的不值一提），免得横幅又长又没重点。
  const english = document.documentElement.lang === "en";
  const parts = bootSegments()
    .filter(([key]) => (seg[key] || 0) > 80)
    .map(([key, label]) => `${label} ${seg[key]} ${english ? "ms" : "毫秒"}`);
  const headline = firstPaint < total
    ? (english ? `First screen in ${(firstPaint / 1000).toFixed(1)} s; latest data ready in ${(total / 1000).toFixed(1)} s` : `首屏 ${(firstPaint / 1000).toFixed(1)} 秒可见，最新数据校准完成共 ${(total / 1000).toFixed(1)} 秒`)
    : (english ? `Opened in ${(total / 1000).toFixed(1)} s` : `这次打开用了 ${(total / 1000).toFixed(1)} 秒`);
  const lines = [`${headline}${english ? ": " : "："}${parts.length ? parts.join(" · ") : (english ? "every stage was under 80 ms" : "各段都不到 80 毫秒")}`];
  if (slow.length) lines.push(english ? `Slowest files: ${slow.map((entry) => `${entry.name} ${entry.ms} ms`).join(", ")}` : `最慢的文件：${slow.map((entry) => `${entry.name} ${entry.ms} 毫秒`).join("、")}`);
  const conclusion = slowConclusion(seg);
  if (conclusion) lines.push(conclusion);
  // 数据体积异常大单独说一句：这是「读数据慢」最常见的原因。
  if ((seg.bytes || 0) > 300000) {
    lines.push(english
      ? `Save data is ${Math.round(seg.bytes / 1024)} KB (normally only tens of KB). Large embedded content may be slowing it down.`
      : `网页数据 ${Math.round(seg.bytes / 1024)} KB（正常几十 KB）→ 里面有体积大的内容，建议删掉带大图的旧网页。`);
  }
  banner.textContent = lines.join("\n");
  banner.hidden = false;
}

// 到底慢在「读存储」还是慢在别的地方，一眼能看出来，不用猜。
function reportOpenSpeed(seg, bootStart, cacheHit) {
  const total = Math.round(nowMs() - bootStart);
  // 命中快照时，用户在真实存储返回前就已经能操作；把“首屏可见”和“后台校准完成”
  // 分开记录，避免一个 6 秒的冷存储读数让人误以为界面也白等了 6 秒。
  const firstPaint = cacheHit ? seg.page + seg.cache + seg.paint : total;
  // 「其余」= 总耗时里没被任何一段认领的部分（比如等待浏览器调度、脚本解析）。
  const other = Math.max(0, total - (seg.page + seg.cache + seg.paint + seg.data + seg.migrate));
  const full = { ...seg, other };
  // 数据超过 300 KB 就值得一说：正常只有几十 KB，大说明里面混进了图片之类的大块内容。
  const fatData = (seg.bytes || 0) > 300000;
  const slow = slowestResources();
  try { console.info(`[LaterOn] 打开耗时 总 ${total} 毫秒`, full, slow); } catch {}
  // 本地快照读起来比预期的慢很多 → 说明这台机器上 localStorage 本身就是慢的，
  // 那就别再一遍遍去读它了（每次 render 都会写一次，慢起来是叠加的）。
  if (seg.cache > 400) localStorageSlow = true;
  // 存一份到存储里：设置页「自检信息 → 侧栏打开耗时」也能看到。
  saveOpenDiag({
    at: Date.now(),
    page: seg.page,
    cache: seg.cache,
    paint: seg.paint,
    data: seg.data,
    migrate: seg.migrate,
    other,
    bytes: seg.bytes || 0,
    total,
    firstPaint,
    cacheHit,
    items: items.length,
    localStorageSlow,
    localStorageOk: probeLocalStorage(),
    slow
  });
  // 只有「真的等住了」才在界面上说话：1 秒以内是正常水平（冷启动时读一次存储
  // 本来就要几百毫秒，而列表早已先用秒开缓存画出来了），弹横幅反而像在报错。
  // 数据照样每次都存进诊断，去设置页「自检信息 → 侧栏打开耗时」随时能翻。
  if (total > 2000) showSlowBanner({ total, firstPaint, seg: full, slow });
}

// localStorage 到底能不能用？用不上「秒开缓存」的话会明显拖慢打开速度，这里记一笔。
function probeLocalStorage() {
  try {
    localStorage.setItem("laterOnProbe", "1");
    localStorage.removeItem("laterOnProbe");
    return true;
  } catch {
    return false;
  }
}

// 写诊断记录：失败了就算了，绝不影响界面。
function saveOpenDiag(record) {
  try { chrome.storage.local.set({ laterOnPanelDiag: record }); } catch {}
}

async function init() {
  // 计时起点：boot.js 在页面 <head> 里记的那一刻（比侧栏脚本更早），
  // 这样「页面加载」和「读数据」花的时间能分别算出来。
  const bootStart = window.LaterOnBoot?.t0 ?? nowMs();
  // 语言设置是独立的存储读取，不能阻塞首屏，也不能把它算进「准备页面」。
  // 先启动请求，下面继续读缓存 / 收藏；完成后再把静态文字切换到用户语言。
  const languagePromise = Promise.resolve(
    window.LaterOnI18n?.ready || window.LaterOnI18n?.getLanguage?.()
  ).catch(() => null);
  const scriptReady = nowMs();   // = 页面 + 脚本就绪时刻（差值 = 浏览器准备页面用了多久）
  // 每一段都单独计时：之前只记了「读数据」，结果总耗时比各段加起来大好几秒，
  // 那几秒花在哪完全看不出来。现在一段都不放过。
  const seg = { page: Math.round(scriptReady - bootStart), cache: 0, paint: 0, data: 0, migrate: 0 };

  // 语言读取完成后再应用翻译；此时如果首屏已经画出来，只重画一次文字和当前列表。
  // 不等待它，避免一次冷 storage 读取把侧栏首屏拖到几秒之后。
  languagePromise.then(() => {
    if (!alive) return;
    window.LaterOnI18n?.applyStatic();
    if (currentItem) syncSaveButtonState(!!currentItemId);
    if (sidePanelReady || cacheHit) {
      render();
    }
  });

  // ① 先把「读存储」发出去，但**不等它**。存储冷的时候这一次读取要好几秒，
  //    早点发出去，它就能和后面的「读本地缓存」「画第一屏」同时跑；
  //    排成一队的话，谁慢整条链就卡在谁后面（这正是之前白等十几秒的原因）。
  const storageStart = nowMs();
  // 封面（COVERS_KEY）故意不在这批里：它可能比整个列表还大，
  // 排在首屏之后单独读，列表才能最快出来。
  const storedPromise = chrome.storage.local
    .get([STORAGE_KEY, PROJECTS_KEY, ACTIVE_PROJECT_KEY, CURRENT_ITEM_KEY, SETTINGS_KEY, FILTER_KEY, FILTER_CHOSEN_KEY, ORDER_KEY, "laterOnCollectionEpoch"])
    .catch((error) => ({ __laterOnLoadError: String(error?.message || error || "读取失败") }));

  // ② 读「秒开缓存」并立刻画第一屏：上一回的列表快照就在本页 localStorage 里，
  //    同步读、立刻画，不用等 chrome.storage 返回。
  let cacheHit = false;
  const cacheStart = nowMs();
  const cached = readSlimCache();
  seg.cache = Math.round(nowMs() - cacheStart);
  if (cached?.length) {
    cacheHit = true;
    items = normalizeItems(cached);
    const paintStart = nowMs();
    render();
    // 响应式赋值只排入 Vue 队列；首批真正提交后再计时，不能漏算首屏绘制。
    await controls.afterPaint();
    if (!alive) return;
    seg.paint = Math.round(nowMs() - paintStart);
  }
  if (typeof window.LaterOnBoot?.stage === "function") window.LaterOnBoot.stage(tr("readingSaves"));

  // ③ 现在才等存储结果（它从 ① 就开始跑了）。
  const stored = await storedPromise;
  if (!alive) return;
  seg.data = Math.round(nowMs() - storageStart);
  // 读取失败和“存储里确实没有收藏”不是一回事。以前两者都落成 {}，随后会把
  // 秒开缓存覆盖成空数组；一次偶发 I/O 错误就可能让下一次也失去可见内容。
  if (stored.__laterOnLoadError) {
    seg.error = stored.__laterOnLoadError;
    if (!cacheHit) {
      render();
      await controls.afterPaint();
      if (!alive) return;
    }
    reportOpenSpeed(seg, bootStart, cacheHit);
    sidePanelReady = true;
    // loadCurrentPage() 会同步重置顶部状态，因此先启动它，再放回这条更重要的读取提示。
    loadCurrentPage();
    status.textContent = cacheHit
      ? tr("noRefreshShowingCache")
      : tr("loadFailedRetry");
    return;
  }
  LaterOnStorage.initialize(stored);
  const migrateStart = nowMs();
  const migrated = await migrateLegacyCovers(stored[STORAGE_KEY]);
  if (!alive) return;
  seg.migrate = Math.round(nowMs() - migrateStart);
  // 读回来的这批数据有多大？体积是「读数据慢」最常见的解释——
  // 早期版本把封面 base64 直接塞在条目里，能塞到好几兆，读完必然慢。
  try { seg.bytes = JSON.stringify(stored[STORAGE_KEY] || []).length; } catch { /* 量不出来就不量 */ }
  items = normalizeItems(migrated || stored[STORAGE_KEY]);
  archivedProjectIds = new Set((stored[PROJECTS_KEY] || []).filter((project) => project.archived).map((project) => project.id));
  projects = (stored[PROJECTS_KEY] || []).filter((project) => !project.archived);
  scope.project = normalizeProject(stored[ACTIVE_PROJECT_KEY]);
  currentItemId = stored[CURRENT_ITEM_KEY] || null;
  controls.autoMarkRead.value = (stored[SETTINGS_KEY] || {}).autoMarkRead !== false;
  sortMode = (stored[SETTINGS_KEY] || {}).defaultSort || "newest";
  orders = stored[ORDER_KEY] || {};
  // 全屏那边可能已经切过筛选了，打开侧栏时接着用同一档。
  scope.filter = stored[FILTER_CHOSEN_KEY] ? normalizeFilter(stored[FILTER_KEY]) : DEFAULT_FILTER;
  const paintStart2 = nowMs();
  render();
  await controls.afterPaint();
  if (!alive) return;
  // 没用上缓存时，这一次才是「第一屏」，它才是用户真正等的那一刻。
  if (!cacheHit) seg.paint = Math.round(nowMs() - paintStart2);
  // 把这次打开的分段耗时记下来并（慢的时候）直接显示在界面上。
  // 异步写存储，绝不等它返回。
  reportOpenSpeed(seg, bootStart, cacheHit);
  // 封面留到最后单独读：它大，但缺了它也只是晚几毫秒显示缩略图，不影响列表先出来。
  loadCovers();
  sidePanelReady = true;
  // 如果这次打开是因为在别处点开了一篇，直接把那篇滚到可视区域里。
  applyCurrentAndLocate();
  // 顶部「当前网页」那一栏不再拖住打开流程：它要唤醒后台抓页面信息，
  // 冷启动可能几秒，让它在后台自己补，列表早就画完了。
  loadCurrentPage();
}

listenChrome(chrome.storage.onChanged, (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    items = normalizeItems(changes[STORAGE_KEY].newValue || []);
    render();
    // 阅读状态等数据刷新不能按旧标签页覆盖用户刚选择的项目。
    if (currentItem?.url) syncCurrentTabItem(currentItem.url, { followProject: false });
  }
  if (area === "local" && changes[COVERS_KEY]) {
    covers = changes[COVERS_KEY].newValue || {};
    render();
  }
  if (area === "local" && changes[PROJECTS_KEY]) {
    archivedProjectIds = new Set((changes[PROJECTS_KEY].newValue || []).filter((project) => project.archived).map((project) => project.id));
    projects = (changes[PROJECTS_KEY].newValue || []).filter((project) => !project.archived);
    if (scope.project !== "unfiled" && !projects.some((project) => project.id === scope.project)) scope.project = "unfiled";
    render();
  }
  if (area === "local" && changes[ACTIVE_PROJECT_KEY]) {
    scope.project = normalizeProject(changes[ACTIVE_PROJECT_KEY].newValue);

    render();
  }
  if (area === "local" && changes[SETTINGS_KEY]) {
    const s = changes[SETTINGS_KEY].newValue || {};
    controls.autoMarkRead.value = s.autoMarkRead !== false;
    const nextSort = s.defaultSort || "newest";
    if (nextSort !== sortMode) { sortMode = nextSort; render(); }
  }
  if (area === "local" && changes[ORDER_KEY]) {
    orders = changes[ORDER_KEY].newValue || {};
    render();
  }
  if (area === "local" && changes[CURRENT_ITEM_KEY]) {
    currentItemId = changes[CURRENT_ITEM_KEY].newValue || null;
    applyCurrentAndLocate();
  }
  if (area === "local" && changes[FILTER_KEY]) {
    // 全屏那边切了筛选 → 这边跟着切（反过来同理）。自己写的值不会变，被这个判断挡掉。
    const next = normalizeFilter(changes[FILTER_KEY].newValue);
    if (next !== scope.filter) { scope.filter = next; render(); }
  }
});

// 封面本体（用户上传的图，可能几百 KB）单独读，读完补画图。
async function loadCovers() {
  try {
    const stored = await chrome.storage.local.get(COVERS_KEY);
    if (!alive) return;
    covers = stored[COVERS_KEY] || {};
    render();
  } catch { /* 封面读不到就先不显示图 */ }
}

// 当前网页这一栏也分两段：先用标签页自带的信息（浏览器本地就有）立刻显示、
// 收藏按钮立刻能点；封面 / 摘要交给后台慢慢补。
// 后台（service worker）空闲时会被 Chrome 回收，唤醒一次可能好几秒，
// 不能让它把整个侧栏拖住——所以这里加了超时，超时就维持基础信息。
const CURRENT_PAGE_TIMEOUT_MS = 4000;

// 给 Promise 加超时：到点就返回兜底值，绝不让界面无限期等下去。
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    promise.then((value) => finish(value), () => finish(fallback));
  });
}

async function loadCurrentPage() {
  const generation = ++loadGeneration;
  resetCurrentPage();
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!alive) return;
    const tab = globalThis.LaterOnUrl?.unwrapSuspendedTab(activeTab) || activeTab;
    if (!tab?.id) throw new Error(tr("noCurrentPage"));
    if (!/^https?:/i.test(tab.url || "")) {
      const scheme = String(tab.url || "").split(":", 1)[0].toLowerCase();
      throw new Error(scheme === "file"
        ? tr("localFileUnsupported")
        : tr("browserPageUnsupported"));
    }
    const fallback = fallbackMetadata(tab);
    // 第一段：立刻显示，按钮放开，不等后台。
    applyCurrentPage({ ...fallback, url: tab.url }, generation);
    // 第二段：抓取交给后台，和「一键收藏」「弹窗」共用同一份逻辑。
    const response = await withTimeout(
      chrome.runtime.sendMessage({ type: "EXTRACT_METADATA", tabId: tab.id }).catch(() => null),
      CURRENT_PAGE_TIMEOUT_MS,
      null
    );
    if (generation !== loadGeneration) return;
    if (response?.ok && response.metadata) {
      // 延迟返回的摘要/封面只补资料，不再次切换用户已选择的项目。
      applyCurrentPage({ ...fallback, ...response.metadata, url: tab.url }, generation, { followProject: false });
    }
  } catch (error) {
    if (generation !== loadGeneration) return;
    document.querySelector("#currentSource").textContent = error.message;
  }
}

function applyCurrentPage(result, generation, options) {
  if (generation !== loadGeneration) return;
  currentItem = { ...result, title: result.title || result.url };
  syncCurrentTabItem(currentItem.url, options);
  document.querySelector("#currentTitle").textContent = currentItem.title;
  document.querySelector("#currentSource").textContent = currentItem.source;
  if (currentItem.image) setCurrentThumb(currentItem.image);
}

listenChrome(chrome.tabs.onActivated, () => loadCurrentPage());
listenChrome(chrome.tabs.onUpdated, (_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) loadCurrentPage();
});

function resetCurrentPage() {
  currentItem = null;
  saveButton.disabled = true;
  saveButton.classList.remove("done", "saved");
  saveButton.querySelector("span").textContent = "＋";
  saveButton.querySelector(".save-label").textContent = tr("saveCurrent");
  document.querySelector("#currentTitle").textContent = tr("currentPage");
  document.querySelector("#currentSource").textContent = tr("currentLoading");
  resetCurrentThumb();
  status.textContent = "";
}

function syncSaveButtonState(isSaved) {
  saveButton.classList.remove("done");
  saveButton.classList.toggle("saved", isSaved);
  saveButton.disabled = isSaved || !currentItem;
  saveButton.querySelector("span").textContent = isSaved ? "✓" : "＋";
  saveButton.querySelector(".save-label").textContent = tr(isSaved ? "currentAdded" : "saveCurrent");
  saveButton.title = tr(isSaved ? "currentAdded" : "saveCurrent");
  saveButton.setAttribute("aria-label", tr(isSaved ? "currentAdded" : "saveCurrent"));
}

function fallbackMetadata(tab) {
  let source = tr("webPage");
  try { source = new URL(tab.url).hostname.replace(/^www\./, ""); } catch {}
  return {
    title: tab.title || tab.url,
    description: tr("noDescription"),
    image: "",
    favicon: tab.favIconUrl || "",
    source
  };
}

// 当前标签页和收藏条目共用网址比较规则：忽略 www、末尾斜杠、追踪参数和普通锚点，
// 保留 #/、#!/ 业务路由，避免分享参数影响匹配或不同页面被误认为同一篇。
function syncCurrentTabItem(url, { followProject = true } = {}) {
  const normalize = globalThis.LaterOnUrl?.normalize || ((value) => String(value || "").trim().toLowerCase());
  const normalized = normalize(url);
  const matched = normalized
    ? items.find((item) => normalize(item.url) === normalized)
    : null;
  const nextId = matched?.id || null;
  const previousId = currentItemId;
  currentItemId = nextId;
  syncSaveButtonState(!!matched);
  // 离开已收藏网页时也同步清空，避免全屏界面或重开的侧栏恢复旧高亮。
  if (previousId !== nextId) chrome.storage.local.set({ [CURRENT_ITEM_KEY]: nextId }).catch(() => {});

  if (matched) {
    // 切换到另一个已收藏标签页时，目标文章可能属于另一个项目。
    // 必须先切换项目再定位，否则它会被旧项目的筛选挡住，卡片根本不在 DOM 里。
    const targetProject = normalizeProject(matched.projectId || "unfiled");
    if (followProject && targetProject !== scope.project) {
      scope.project = targetProject;

      render();
      // 与全屏界面共享当前项目；侧栏跟随标签页后，下次打开也继续停在这里。
      chrome.storage.local.set({ [ACTIVE_PROJECT_KEY]: scope.project }).catch(() => {});
    }
    // render() 之后由 applyCurrentAndLocate 负责高亮与定位；
    // 项目没变时则直接复用已经画好的卡片。
    applyCurrentAndLocate();
    return;
  }

  // 当前页面从未收藏过：取消旧的“正在阅读”高亮并回到侧栏顶部，方便直接收藏。
  controls.locate(null);
  window.scrollTo({ top: 0, behavior: "auto" });
}

listen(saveButton, "click", async () => {
  if (!currentItem || currentItemId) return;
  saveButton.disabled = true;
  // 统一交给后台处理（和快捷键、右键菜单同一条链路）：
  // 设置里打开「收藏单篇前先选项目」时，点这里同样会先在网页里弹出选项目浮层。
  const response = await chrome.runtime.sendMessage({ type: "QUICK_SAVE_TAB", source: "panel" }).catch(() => null);
  if (response?.ok && response.pending) {
    // 已经弹出浮层了，真正的收藏等用户在浮层里确认（结果会弹在网页上）。
    saveButton.disabled = false;
    status.textContent = tr("pickerOpened");
    return;
  }
  if (response?.ok) {
    syncSaveButtonState(true);
    status.textContent = "";
  } else {
    saveButton.disabled = false;
    status.textContent = response?.error || tr("saveFailed");
  }
});

document.querySelector("#openLibrary").addEventListener("click", async () => {
  let libraryOpened = false;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_LIBRARY",
      context: {
        source: "sidepanel",
        projectId: scope.project,
        filter: scope.filter,
        focusItemId: currentItemId
      }
    });
    if (!response?.ok || !activeTab?.windowId) throw new Error("完整界面未能打开");
    libraryOpened = true;
    await chrome.sidePanel.close({ windowId: activeTab.windowId });
  } catch (error) {
    console.error("切换完整界面失败", error);
    if (libraryOpened) window.close();
    else status.textContent = tr("libraryOpenFailed");
  }
});
// 骨架屏 / 「正在打开…」提示条：真内容一画出来就撤掉，让真界面露面。
// body 上的 .booting 一去掉，#appBody 就从「不占位」变回正常显示，两者不会同时出现。
function hideBootPlaceholder() {
  document.querySelector("#bootSkeleton")?.remove();
  document.querySelector("#bootTip")?.remove();
  document.body?.classList.remove("booting");
  if (typeof window.LaterOnBoot?.done === "function") window.LaterOnBoot.done();
}

function render() {
  if (!alive) return;
  controls.update({ items, projects, archivedProjectIds, orders, sortMode }, covers);
  // Vue 首批提交后撤骨架；快照写入仍在后续事件循环，不挡住眼前绘制。
  saveSlimCache();
}

function applyCurrentAndLocate() {
  controls.locate(currentItemId);
}

function normalizeProject(projectId) {
  return normalizePanelProject(projectId, projects);
}

function normalizeItems(list) {
  return LaterOnItemState.normalizeItems(list);
}

// 一次性搬家：把还躺在收藏列表里的 base64 封面挪到单独的键里。
// 搬完列表数据回归「纯文字」，读写都快。已搬过（没有 data: 封面）就什么都不做。
async function migrateLegacyCovers(rawItems) {
  if (!LaterOnItemState.needsLegacyMigration(rawItems)) return null;
  try {
    const response = await LaterOnStorage.run("migrateLegacyData");
    covers = response.covers;
    return response.items;
  } catch { return null; }
}

// ── 秒开缓存 ────────────────────────────────────────────────
// 收藏列表（不含封面本体，那在 COVERS_KEY 里）的快照存本页 localStorage。
// 侧栏每次重新画完都存一份，下次打开先拿它画第一屏。
// 写快照是给「下一次打开」用的，不急——推迟到下一轮事件循环再写，
// 这样它永远不会挡住眼前的这一次绘制。
function saveSlimCache() {
  if (localStorageSlow) return;
  if (cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    if (localStorageSlow) return;
    try {
      // 快照按最近添加选取首屏；导入数据的数组可能乱序，不能直接截取前 12 条。
      const preview = sortCollectionItems(items.filter((item) => !archivedProjectIds.has(item.projectId)), "newest").slice(0, CACHE_PREVIEW_LIMIT);
      const json = JSON.stringify(preview);
      if (json.length < 2000000) localStorage.setItem(CACHE_KEY, json);
      else localStorage.removeItem(CACHE_KEY);
    } catch { /* localStorage 用不了就算了，不影响正常功能 */ }
  }, 300);
}
function readSlimCache() {
  if (localStorageSlow) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}



// 没抓到封面（或封面加载不出来）时，缩略图区域继续显示 LaterOn 的 Logo。
function resetCurrentThumb() {
  const thumb = document.querySelector("#currentThumb");
  thumb.style.backgroundImage = "";
  thumb.classList.remove("has-cover");
}

function setCurrentThumb(src) {
  const thumb = document.querySelector("#currentThumb");
  const probe = new Image();
  // 先悄悄试加载：确认拿得到图才盖到缩略图上，拿不到就让 Logo 继续兜底。
  probe.addEventListener("load", () => {
    thumb.style.backgroundImage = `url("${src.replace(/"/g, "%22")}")`;
    thumb.classList.add("has-cover");
  });
  probe.addEventListener("error", () => {
    const fallback = nextCoverFallback(src);
    if (fallback) setCurrentThumb(fallback);
    else resetCurrentThumb();
  });
  probe.src = src;
}

return () => {
  alive = false;
  sidePanelReady = false;
  loadGeneration++;
  cleanups.forEach(stop => stop());
  timers.forEach(id => window.clearTimeout(id));
  frames.forEach(id => window.cancelAnimationFrame(id));
};
}
