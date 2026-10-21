// Actual URL helpers + worker with isolated storage; never touches user tabs or data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
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
    async set(patch) { Object.assign(data, clone(patch)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  });
  const listeners = [];
  const menus = [];
  const tabs = [clone(frozen)];
  const injections = [];
  const created = [];
  const updates = [];
  const fetches = [];
  let fetchMode = "success";
  let failCreate = false;
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
    action: {}, commands: { onCommand: event() },
    contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: { addListener(fn) { menus.push(fn); } } },
    scripting: {
      async insertCSS(options) { injections.push(options); },
      async executeScript(options) { injections.push(options); return [{ result: null }]; }
    }
  };
  const ctx = vm.createContext({
    chrome, URL, URLSearchParams, crypto: webcrypto, TextEncoder, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    async fetch(url, options) {
      fetches.push({ url, options });
      if (fetchMode === "fail") throw new Error("OFFLINE");
      return { ok: true, headers: { get: () => "text/html" }, text: async () => '<html><head><title>Example Domain</title><meta property="og:description" content="后台摘要"><meta property="og:image" content="https://example.com/cover.jpg"></head></html>' };
    },
    importScripts(...files) { for (const file of files) vm.runInContext(source(file), ctx, { filename: file }); }
  });
  vm.runInContext(source("background.js"), ctx, { filename: "background.js" });
  ctx.showActionFeedback = async () => {};
  const send = (message) => new Promise((resolve, reject) => {
    for (const listener of listeners) {
      try { if (listener(message, {}, resolve) === true) return; } catch (error) { reject(error); return; }
    }
    reject(new Error(`UNHANDLED: ${message.type}`));
  });
  return { ctx, local, session, tabs, injections, created, updates, fetches, send, menus,
    offline() { fetchMode = "fail"; }, failCreate() { failCreate = true; } };
}

(async () => {
  const app = worker();
  await app.ctx.ensureLegacyCleanup();
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
  const batch = await app.ctx.saveAllTabsInWindow();
  assert.equal(batch.ok, true);
  assert.equal(app.local.laterOnItems.length, before, "整窗内原页与冻结页共用收藏身份");
  assert.equal(app.local.laterOnDiag.lastTabCount, 2, "冻结页计入整窗范围，内部页排除");
  const metadata = await app.send({ type: "EXTRACT_METADATA", tabId: 1 });
  assert.equal(metadata.metadata.url, samples[0]);
  assert.equal(metadata.metadata.description, "后台摘要");
  assert.equal((await app.send({ type: "QUICK_SAVE_TAB", tabId: 11 })).ok, false);

  const offline = worker();
  offline.offline();
  await offline.ctx.handleCommand("quick-save", offline.tabs[0]);
  assert.equal(offline.local.laterOnItems[0].url, samples[0]);
  assert.equal(offline.local.laterOnItems[0].title, "原标题");
  assert.equal(offline.local.laterOnItems[0].image, "");
  assert.equal(offline.local.laterOnItems[0].description, "暂无摘要");
  await offline.ctx.handleCommand("toggle-translation", offline.tabs[0]);
  assert.equal(offline.injections.length, 0, "冻结页翻译不注入其他扩展");
  offline.tabs[0].url = frozenUrl("https://example.com/menu");
  await offline.ctx.quickSave(offline.tabs[0], "menu");
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
  await picker.ctx.saveAllTabsInWindow();
  const oldId = picker.session.laterOnPendingBatch.batchId;
  await picker.ctx.saveAllTabsInWindow();
  const newId = picker.session.laterOnPendingBatch.batchId;
  assert.notEqual(newId, oldId);
  assert.equal((await picker.send({ type: "GET_PENDING_PICKER", batchId: oldId })).ok, false);
  assert.equal((await picker.send({ type: "CONFIRM_BATCH_SAVE", batchId: oldId, projectId: "work" })).ok, false);
  assert.equal((await picker.send({ type: "CANCEL_BATCH_SAVE", batchId: oldId })).cancelled, false);
  assert.equal(picker.session.laterOnPendingBatch.batchId, newId, "旧选择页不能确认或取消新批次");
  const claims = await Promise.all([picker.ctx.claimPendingBatch("work", newId), picker.ctx.claimPendingBatch("work", newId)]);
  assert.equal(claims.filter(Boolean).length, 1, "同时确认也只领取一次");
  await picker.ctx.saveAllTabsInWindow();
  picker.session.laterOnPendingBatch.createdAt = Date.now() - 11 * 60 * 1000;
  const expiredId = picker.session.laterOnPendingBatch.batchId;
  assert.equal((await picker.send({ type: "GET_PENDING_PICKER", batchId: expiredId })).ok, false);
  assert.equal(await picker.ctx.claimPendingBatch("work", expiredId), null);
  await picker.ctx.saveAllTabsInWindow();
  assert.equal((await picker.send({ type: "CANCEL_BATCH_SAVE", batchId: picker.session.laterOnPendingBatch.batchId })).cancelled, true);

  const unavailable = worker();
  unavailable.local.laterOnSettings.askFolderOnBatch = true;
  unavailable.failCreate();
  assert.equal((await unavailable.ctx.saveAllTabsInWindow()).ok, false);
  assert.equal(unavailable.session.laterOnPendingBatch, undefined);
  assert.equal(unavailable.local.laterOnItems.length, 0, "选择器打不开时不擅自保存到默认项目");

  console.log("PASS 冻结网址无损解析、收藏入口、降级、去重、项目选择与批次隔离");
})().catch((error) => { console.error(error); process.exitCode = 1; });
