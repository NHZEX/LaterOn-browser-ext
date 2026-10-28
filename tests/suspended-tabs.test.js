const sourcePath = require("./helpers/source-path.cjs");
// Actual URL helpers + worker with isolated storage; never touches user tabs or data.
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const source = require("./helpers/read-runtime.cjs");
const clone = (value) => JSON.parse(JSON.stringify(value));
const prefix = "chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html";
const frozenUrl = (url, title = "Example Domain") => `${prefix}#ttl=${encodeURIComponent(title)}&pos=300&uri=${url}`;
const samples = [
  "https://example.com/page?a=1&b=2",
  "https://example.com/search?q=C++",
  "https://example.com/a%2Fb?q=x%23y",
  "https://example.com/page?a=1#section-2",
  "https://linux.do/t/topic/2680349",
  "https://example.com/page?uri=inner&url=another&ttl=value#route?x=1&y=2",
  "https://example.com/%252F?q=%25+%2B&empty=&empty=2"
];
const utils = vm.createContext({ URL });
vm.runInContext(source("url-utils.js"), utils);
const { suspendedPage, unwrapSuspendedUrl, unwrapSuspendedTab, normalize } = utils.LaterOnUrl;
for (const url of samples) {
  assert.equal(unwrapSuspendedUrl(frozenUrl(url)), url, "原网址逐字符保留");
  assert.equal(suspendedPage(frozenUrl(url, "中文 C++ & 标题 #1")).title, "中文 C++ & 标题 #1");
  assert.equal(normalize(unwrapSuspendedUrl(frozenUrl(url))), normalize(url));
}
assert.equal(unwrapSuspendedUrl(`${prefix}#ttl=Test&url=${encodeURIComponent(samples[2])}&pos=0`), samples[2]);
assert.equal(unwrapSuspendedUrl(`${prefix}#uri=${encodeURIComponent(samples[0])}`), samples[0]);
for (const value of [
  "chrome://settings/", "https://example.com/suspended.html#uri=https://site.test/", "",
  `${prefix}#ttl=Empty&pos=0`, `${prefix}#uri=javascript:alert(1)`, `${prefix}#uri=file:///test`,
  `${prefix}#uri=https://`, `${prefix}#uri=https://example.com:bad/`, `${prefix}#uri=https://site.test/a b`,
  `${prefix}#uri=https%3A%2F%2Fsite.test%2F%ZZ`, `${prefix}#noturi=https://site.test/`,
  "chrome-extension://fixture/library.html#uri=https://site.test/"
]) assert.equal(unwrapSuspendedUrl(value), value, "无效占位页和内部页原样返回");
assert.equal(suspendedPage(null), null);
assert.equal(suspendedPage(`${prefix}#ttl=%ZZ&uri=${samples[0]}`).title, "");
const ordinary = { id: 10, url: samples[0], title: "普通网页" };
assert.equal(unwrapSuspendedTab(ordinary), ordinary, "普通标签保持对象身份");
const frozen = { id: 1, url: frozenUrl(samples[0], "原标题"), title: "扩展占位标题", favIconUrl: "chrome-extension://other/icon.png", active: true, windowId: 1 };
assert.equal(unwrapSuspendedTab(frozen).title, "原标题");
assert.equal(unwrapSuspendedTab(frozen).favIconUrl, "");
assert.equal(unwrapSuspendedTab(frozen).suspended, true);
assert.equal(frozen.title, "扩展占位标题", "不修改浏览器返回的原标签");

function worker() {
  const local = { laterOnItems: [], laterOnProjects: [{ id: "work", name: "工作" }], laterOnSettings: { askFolderOnBatch: false } };
  const session = {};
  const storage = (data) => ({
    async get(keys) {
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(data);
      return clone(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(patch) {
      if (data === local && failItemWrite && Object.hasOwn(patch, "laterOnItems")) throw new Error("SAVE_FAILED");
      Object.assign(data, clone(patch));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  });
  const listeners = [];
  const menus = [];
  const commands = [];
  const notifications = [];
  const badges = [];
  const tabs = [clone(frozen)];
  const injections = [];
  const created = [];
  const updates = [];
  const fetches = [];
  let fetchMode = "success";
  let failCreate = false;
  let failItemWrite = false;
  let failNotification = false;
  const event = () => ({ addListener() {} });
  const chrome = {
    storage: { local: storage(local), session: storage(session), onChanged: event() },
    runtime: {
      getURL: (file) => `chrome-extension://lateron/${file}`,
      onMessage: { addListener(fn) { listeners.push(fn); } }, onInstalled: event(), onStartup: event()
    },
    tabs: {
      async get(id) { const tab = tabs.find((tab) => tab.id === id); if (!tab) throw new Error("NO_TAB"); return clone(tab); },
      async query(filter) { return clone(filter.active ? tabs.filter((tab) => tab.active) : tabs); },
      async create(options) { if (failCreate) throw new Error("CREATE_FAILED"); created.push(options); return { id: 99 }; },
      async update(id, patch) { updates.push({ id, patch }); },
      onUpdated: event(), onRemoved: event(), onCreated: event(), onActivated: event()
    },
    action: { async setBadgeText({ text }) { badges.push(text); }, async setBadgeBackgroundColor() {}, async setTitle() {} },
    commands: { onCommand: { addListener(fn) { commands.push(fn); } } },
    notifications: { async create(id, options) {
      if (failNotification) throw new Error("NOTIFICATIONS_DISABLED");
      notifications.push({ id, ...clone(options) });
      return id;
    } },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: { addListener(fn) { menus.push(fn); } } },
    scripting: {
      async insertCSS(options) { injections.push(options); },
      async executeScript(options) { injections.push(options); return [{ result: null }]; }
    }
  };
  const ctx = vm.createContext({
    chrome, URL, URLSearchParams, crypto: webcrypto, TextEncoder, console,
    setTimeout(...args) { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout, setInterval, clearInterval,
    async fetch(url, options) {
      fetches.push({ url, options });
      if (fetchMode === "fail") throw new Error("OFFLINE");
      return { ok: true, headers: { get: () => "text/html" }, text: async () => '<html><head><title>Example Domain</title><meta property="og:description" content="后台摘要"><meta property="og:image" content="https://example.com/cover.jpg"></head></html>' };
    },
    importScripts(...files) { for (const file of files) vm.runInContext(source(file), ctx, { filename: file }); }
  });
  vm.runInContext(source("background-test-api.js"), ctx, { filename: "background.js" });
  const send = (message) => new Promise((resolve, reject) => {
    for (const listener of listeners) {
      try { if (listener(message, {}, resolve) === true) return; } catch (error) { reject(error); return; }
    }
    reject(new Error(`UNHANDLED: ${message.type}`));
  });
  return { ctx, local, session, tabs, injections, created, updates, fetches, send, menus, commands, notifications, badges,
    offline() { fetchMode = "fail"; }, failCreate() { failCreate = true; },
    failWrites() { failItemWrite = true; }, allowWrites() { failItemWrite = false; },
    disableNotifications() { failNotification = true; } };
}

async function until(check, label) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), label);
}

(async () => {
  const app = worker();
  await app.ctx.backgroundTest.ensureLegacyCleanup();
  for (const url of samples) {
    app.tabs[0].url = frozenUrl(url);
    const result = await app.send({ type: "QUICK_SAVE_TAB", tabId: 1 });
    assert.equal(result.ok, true);
    assert.equal(app.local.laterOnItems.find((item) => item.url === url)?.url, url, "收藏入库保持原地址");
  }
  assert.ok(app.fetches.every((entry) => entry.options.credentials === "omit"));
  assert.equal(app.injections.length, 0, "冻结页不注入提取、提示或选择脚本");
  assert.equal(app.updates.length, 0, "收藏不导航或激活冻结标签");
  assert.equal(app.created.length, 0, "无需选项目时不创建页面");

  app.tabs[0].url = frozenUrl(samples[0]);
  const before = app.local.laterOnItems.length;
  app.tabs.push({ ...ordinary, active: false, windowId: 1 }, { id: 11, url: "chrome://settings/", active: false });
  const batch = await app.ctx.backgroundTest.saveAllTabsInWindow();
  assert.equal(batch.ok, true);
  assert.equal(app.local.laterOnItems.length, before, "整窗内原页与冻结页共用收藏身份");
  assert.equal(app.local.laterOnDiag.lastTabCount, 2, "冻结页计入整窗范围，内部页排除");
  const metadata = await app.send({ type: "EXTRACT_METADATA", tabId: 1 });
  assert.equal(metadata.metadata.url, samples[0]);
  assert.equal(metadata.metadata.description, "后台摘要");
  assert.equal((await app.send({ type: "QUICK_SAVE_TAB", tabId: 11 })).ok, false);

  const offline = worker();
  offline.offline();
  await offline.ctx.backgroundTest.handleCommand("quick-save", offline.tabs[0]);
  assert.equal(offline.local.laterOnItems[0].url, samples[0]);
  assert.equal(offline.local.laterOnItems[0].title, "原标题");
  assert.equal(offline.local.laterOnItems[0].image, "");
  assert.equal(offline.local.laterOnItems[0].description, "暂无摘要");
  await offline.ctx.backgroundTest.handleCommand("toggle-translation", offline.tabs[0]);
  assert.equal(offline.injections.length, 0, "冻结页翻译不注入其他扩展");
  offline.tabs[0].url = frozenUrl("https://example.com/menu");
  await offline.ctx.backgroundTest.quickSave(offline.tabs[0], "menu");
  assert.ok(offline.local.laterOnItems.some((item) => item.url === "https://example.com/menu"));

  const picker = worker();
  picker.local.laterOnSettings = { askFolderOnSingle: true, askFolderOnSingleOptIn: true };
  const pending = await picker.send({ type: "QUICK_SAVE_TAB", tabId: 1 });
  assert.equal(pending.pending, true);
  assert.equal(picker.local.laterOnItems.length, 0, "先选项目期间尚未收藏");
  const batchId = picker.session.laterOnPendingBatch.batchId;
  assert.equal(picker.session.laterOnPendingBatch.tabs[0].suspended, true);
  assert.equal(picker.session.laterOnPendingBatch.tabs[0].url, samples[0]);
  assert.equal(new URL(picker.created[0].url).searchParams.get("batch"), batchId);
  const payload = await picker.send({ type: "GET_PENDING_PICKER", batchId });
  assert.equal(payload.ok, true);
  assert.equal(payload.payload.pages[0].url, samples[0]);
  assert.equal(payload.payload.folders[1].id, "work");
  const chosen = await picker.send({ type: "CONFIRM_BATCH_SAVE", batchId, projectId: "work" });
  assert.equal(chosen.ok, true);
  for (let i = 0; i < 100 && !picker.local.laterOnItems.length; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(picker.local.laterOnItems[0].projectId, "work");
  assert.equal(picker.injections.length, 0, "确认后的会话快照仍跳过冻结页注入");

  picker.local.laterOnSettings.askFolderOnBatch = true;
  await picker.ctx.backgroundTest.saveAllTabsInWindow();
  const oldId = picker.session.laterOnPendingBatch.batchId;
  await picker.ctx.backgroundTest.saveAllTabsInWindow();
  const newId = picker.session.laterOnPendingBatch.batchId;
  assert.notEqual(newId, oldId);
  assert.equal((await picker.send({ type: "GET_PENDING_PICKER", batchId: oldId })).ok, false);
  assert.equal((await picker.send({ type: "CONFIRM_BATCH_SAVE", batchId: oldId, projectId: "work" })).ok, false);
  assert.equal((await picker.send({ type: "CANCEL_BATCH_SAVE", batchId: oldId })).cancelled, false);
  assert.equal(picker.session.laterOnPendingBatch.batchId, newId, "旧选择页不能确认或取消新批次");
  const claims = await Promise.all([picker.ctx.backgroundTest.claimPendingBatch("work", newId), picker.ctx.backgroundTest.claimPendingBatch("work", newId)]);
  assert.equal(claims.filter(Boolean).length, 1, "同时确认也只领取一次");
  await picker.ctx.backgroundTest.saveAllTabsInWindow();
  picker.session.laterOnPendingBatch.createdAt = Date.now() - 11 * 60 * 1000;
  const expiredId = picker.session.laterOnPendingBatch.batchId;
  assert.equal((await picker.send({ type: "GET_PENDING_PICKER", batchId: expiredId })).ok, false);
  assert.equal(await picker.ctx.backgroundTest.claimPendingBatch("work", expiredId), null);
  await picker.ctx.backgroundTest.saveAllTabsInWindow();
  assert.equal((await picker.send({ type: "CANCEL_BATCH_SAVE", batchId: picker.session.laterOnPendingBatch.batchId })).cancelled, true);

  const unavailable = worker();
  unavailable.local.laterOnSettings.askFolderOnBatch = true;
  unavailable.failCreate();
  assert.equal((await unavailable.ctx.backgroundTest.saveAllTabsInWindow()).ok, false);
  assert.equal(unavailable.session.laterOnPendingBatch, undefined);
  assert.equal(unavailable.local.laterOnItems.length, 0, "选择器打不开时不擅自保存到默认项目");

  const routes = worker();
  routes.offline();
  await routes.ctx.backgroundTest.ensureLegacyCleanup();
  const routeA = "https://routes.test/app#/article/1?q=C++&part=2";
  const routeAReordered = "https://routes.test/app#/article/1?part=2&q=C++";
  const routeB = "https://routes.test/app#/article/2?part=2&q=C++";
  const bangRoute = "https://routes.test/app#!/article/1?part=2&q=C++";
  routes.tabs[0].url = frozenUrl(routeA);
  assert.equal((await routes.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).ok, true);
  routes.tabs[0].url = frozenUrl(routeAReordered);
  assert.equal((await routes.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).duplicated, true, "单篇按同一路由身份去重");
  assert.equal(routes.local.laterOnItems[0].url, routeA, "比较键不覆写已收藏的原网址");
  routes.tabs.push(
    { id: 2, windowId: 1, active: false, url: frozenUrl(routeB) },
    { id: 3, windowId: 1, active: false, url: routeB, discarded: true },
    { id: 4, windowId: 1, active: false, url: frozenUrl(bangRoute) }
  );
  const routeBatch = await routes.ctx.backgroundTest.saveAllTabsInWindow();
  assert.equal(routeBatch.added, 2, "批量新增独立 hash 路由，普通页和冻结页不重复");
  assert.equal(routeBatch.duplicated, 2);
  assert.deepEqual(routes.local.laterOnItems.map(item => item.url).sort(), [routeA, routeB, bangRoute].sort());
  routes.local.laterOnSettings.askFolderOnBatch = true;
  const routePicker = await routes.ctx.backgroundTest.saveAllTabsInWindow();
  assert.equal(routePicker.pending, true);
  const routePickerPayload = await routes.send({ type: "GET_PENDING_PICKER", batchId: routes.session.laterOnPendingBatch.batchId });
  assert.equal(routePickerPayload.payload.savedCount, 3, "选择项目前的已收藏计数按同一身份去重");
  assert.equal(routes.updates.length, 0, "收集路由网址不改变任何标签页");

  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("notifications"), "构建清单声明系统通知权限");
  assert.ok(readFileSync(sourcePath("icon128.png")).length, "系统通知图标存在");

  for (const language of ["zh-CN", "en"]) {
    const feedback = worker();
    await feedback.ctx.backgroundTest.ensureLegacyCleanup();
    feedback.local.laterOnSettings.language = language;
    const added = await feedback.send({ type: "QUICK_SAVE_TAB", tabId: 1 });
    assert.equal(added.ok, true);
    assert.equal(feedback.notifications.length, 1, "侧栏收藏冻结页后发出一次系统结果通知");
    assert.equal(feedback.notifications[0].title, "StaySide");
    assert.equal(feedback.notifications[0].type, "basic");
    assert.equal(feedback.notifications[0].iconUrl, "chrome-extension://lateron/icon128.png");
    assert.equal(feedback.notifications[0].silent, true);
    assert.match(feedback.notifications[0].message, language === "en" ? /^Added:/ : /^已添加：/);
    const duplicate = await feedback.send({ type: "QUICK_SAVE_TAB", tabId: 1 });
    assert.equal(duplicate.duplicated, true);
    assert.equal(feedback.notifications.length, 2);
    assert.equal(feedback.notifications[1].message, language === "en" ? "This page is already added" : "这个网页已经添加过了");
    assert.equal(feedback.local.laterOnItems.length, 1);
    feedback.local.laterOnItems[0].image = "";
    assert.equal((await feedback.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).refreshed, true);
    assert.match(feedback.notifications.at(-1).message, language === "en" ? /^Details updated:/ : /^已更新信息：/);
    feedback.tabs[0].url = frozenUrl("https://example.com/failure");
    feedback.failWrites();
    const failed = await feedback.send({ type: "QUICK_SAVE_TAB", tabId: 1 });
    assert.equal(failed.ok, false);
    assert.equal(feedback.local.laterOnItems.length, 1, "保存失败不改变原收藏");
    assert.equal(feedback.notifications.length, 4, "保存失败只有一条结果通知");
    assert.match(feedback.notifications.at(-1).message, language === "en" ? /^Failed:.*SAVE_FAILED/ : /^操作失败：.*SAVE_FAILED/);
    assert.equal(feedback.badges.at(-1), "!");
    feedback.allowWrites();
    assert.equal((await feedback.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).ok, true, "失败后可以重试");
    assert.equal(feedback.local.laterOnItems.length, 2);
    assert.equal(feedback.injections.length, 0, "成功、失败和重试均不向冻结页注入脚本");
  }

  for (const entry of ["shortcut", "menu"]) {
    const feedback = worker();
    await feedback.ctx.backgroundTest.ensureLegacyCleanup();
    const invoke = () => entry === "shortcut"
      ? feedback.commands[0]("quick-save", clone(feedback.tabs[0]))
      : feedback.menus[0]({ menuItemId: "lateron-save-page" }, clone(feedback.tabs[0]));
    await invoke();
    assert.equal(feedback.notifications.length, 1, `${entry} 真实事件入口显示成功通知`);
    feedback.tabs[0].url = frozenUrl(`https://example.com/${entry}-failure`);
    feedback.failWrites();
    await invoke();
    assert.equal(feedback.notifications.length, 2, `${entry} 真实事件入口显示失败通知`);
    assert.match(feedback.notifications.at(-1).message, /操作失败：.*SAVE_FAILED/);
    assert.equal(feedback.badges.at(-1), "!");
  }

  const disabled = worker();
  await disabled.ctx.backgroundTest.ensureLegacyCleanup();
  disabled.disableNotifications();
  assert.equal((await disabled.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).ok, true, "通知失败不把收藏成功误报为失败");
  assert.equal(disabled.local.laterOnItems.length, 1);
  assert.equal(disabled.badges.at(-1), "✓", "系统通知不可用时保留成功角标");
  disabled.tabs[0].url = frozenUrl("https://example.com/disabled-failure");
  disabled.failWrites();
  assert.equal((await disabled.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).ok, false);
  assert.equal(disabled.badges.at(-1), "!", "系统通知不可用时保留失败角标");

  const normal = worker();
  normal.tabs[0] = { ...ordinary, id: 1, active: true, windowId: 1 };
  assert.equal((await normal.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).ok, true);
  assert.equal(normal.notifications.length, 0, "普通网页继续使用页内提示");
  assert.ok(normal.injections.some(injection => injection.args?.[0]?.[0]?.text?.startsWith("已添加：")));

  const batchFeedback = worker();
  batchFeedback.tabs.push({ id: 2, active: false, windowId: 1, url: frozenUrl("https://example.com/second") });
  assert.equal((await batchFeedback.ctx.backgroundTest.saveAllTabsInWindow()).added, 2);
  assert.equal(batchFeedback.notifications.length, 1, "冻结页整窗收藏只发最终系统通知，避免逐条刷屏");
  assert.match(batchFeedback.notifications[0].message, /^全部完成：新增 2 篇/);
  batchFeedback.tabs[0].url = frozenUrl("https://example.com/batch-failure");
  batchFeedback.failWrites();
  assert.equal((await batchFeedback.ctx.backgroundTest.saveAllTabsInWindow()).ok, false);
  assert.equal(batchFeedback.notifications.length, 2);
  assert.match(batchFeedback.notifications.at(-1).message, /操作失败：.*SAVE_FAILED/);

  const afterPicker = worker();
  afterPicker.local.laterOnSettings = { askFolderOnSingle: true, askFolderOnSingleOptIn: true };
  assert.equal((await afterPicker.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).pending, true);
  assert.equal(afterPicker.notifications.length, 0, "尚未确认项目时不发成功通知");
  const pendingId = afterPicker.session.laterOnPendingBatch.batchId;
  afterPicker.tabs.splice(0, 1, { id: 99, active: true, windowId: 1, url: "chrome-extension://lateron/save-project-picker.html" });
  assert.equal((await afterPicker.send({ type: "CONFIRM_BATCH_SAVE", batchId: pendingId, projectId: "work" })).ok, true);
  await until(() => afterPicker.local.laterOnDiag?.lastStage === "完成", "选择项目后的后台收藏完成");
  assert.equal(afterPicker.notifications.length, 1, "原冻结标签关闭且焦点留在选择页时仍显示结果");
  assert.equal(afterPicker.local.laterOnItems[0].projectId, "work");
  assert.equal(afterPicker.injections.length, 0);

  const pickerFailure = worker();
  pickerFailure.local.laterOnSettings = { askFolderOnSingle: true, askFolderOnSingleOptIn: true };
  assert.equal((await pickerFailure.send({ type: "QUICK_SAVE_TAB", tabId: 1 })).pending, true);
  pickerFailure.failWrites();
  await pickerFailure.send({ type: "CONFIRM_BATCH_SAVE", batchId: pickerFailure.session.laterOnPendingBatch.batchId, projectId: "work" });
  await until(() => pickerFailure.notifications.length === 1, "确认项目后保存失败有系统通知");
  assert.match(pickerFailure.notifications[0].message, /操作失败：.*SAVE_FAILED/);
  assert.equal(pickerFailure.local.laterOnItems.length, 0);

  assert.equal(unavailable.notifications.length, 1, "项目选择页打不开时也显示系统失败通知");
  assert.match(unavailable.notifications[0].message, /没能打开项目选择框/);

  console.log("PASS 冻结网址无损解析、收藏入口、降级、去重、项目选择、批次隔离及系统通知");
})().catch((error) => { console.error(error); process.exitCode = 1; });
