const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { createWorkerContext } = require("./helpers/worker-context.cjs");
const { webcrypto } = require("node:crypto");
const FakeTimers = require("@sinonjs/fake-timers");
const read = require("./helpers/read-runtime.cjs");

const URL_A = "https://save-close.test/article";
const MENU = "lateron-save-and-close";
const SELECTED_MENU = "lateron-save-selected-tabs";
const clone = structuredClone;

async function worker(t, { picker = false, frozen = false, language = "zh-CN" } = {}) {
  const events = {};
  const event = name => ({
    addListener(listener) { (events[name] ??= new Set()).add(listener); },
    removeListener(listener) { events[name]?.delete(listener); }
  });
  const state = { laterOnCleanupV165: true, laterOnItems: [], laterOnProjects: [{ id: "work", name: "Work" }],
    laterOnSettings: { language, autoCleanEnabled: false, askFolderOnSingle: picker, askFolderOnSingleOptIn: picker } };
  const session = {}, notices = [], removed = [], menus = [], created = [], overlays = [];
  const tabs = [{ id: 1, windowId: 1, active: true, highlighted: true, title: "Article", url: frozen
    ? `chrome-extension://suspender/suspended.html#ttl=Article&uri=${URL_A}` : URL_A },
    { id: 2, windowId: 1, active: false, url: "https://save-close.test/other" }];
  const controls = { failWrite: false, failClose: false, pickerAvailable: true, currentWindowId: 1 };
  const storage = data => ({
    async get(keys) { const names = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return clone(Object.fromEntries(names.filter(key => key in data).map(key => [key, data[key]]))); },
    async set(patch) { if (data === state && controls.failWrite && "laterOnItems" in patch) throw Error("SAVE_FAILED"); Object.assign(data, clone(patch)); },
    async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete data[key]; }); }
  });
  const chrome = {
    storage: { local: storage(state), session: storage(session), onChanged: event("storage") },
    runtime: { getURL: name => `chrome-extension://stayside/${name}`, onMessage: event("messages"), onInstalled: event("installed"), onStartup: event("startup") },
    tabs: {
      async query(filter) {
        const windowId = filter.windowId ?? (filter.currentWindow ? controls.currentWindowId : undefined);
        return clone(tabs.filter(tab => (windowId === undefined || tab.windowId === windowId)
          && (!filter.active || tab.active) && (!filter.highlighted || tab.highlighted)));
      },
      async get(id) { const tab = tabs.find(tab => tab.id === id); if (!tab) throw Error("NO_TAB"); return clone(tab); },
      async remove(id) { if (controls.failClose) throw Error("CLOSE_FAILED"); removed.push({ id, at: clock.now }); tabs.splice(tabs.findIndex(tab => tab.id === id), 1); },
      async create(options) { created.push(clone(options)); return { id: 99 }; },
      onUpdated: event("updated"), onRemoved: event("removed"), onActivated: event("activated"), onCreated: event("created")
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    contextMenus: { removeAll(callback) { menus.length = 0; callback(); }, create(options, callback) { menus.push(clone(options)); callback?.(); }, onClicked: event("menu") },
    commands: { onCommand: event("commands") },
    permissions: { async contains() { return true; } },
    notifications: { async getPermissionLevel() { return "granted"; }, async create(id, options) {
      notices.push({ ...clone(options), system: true, at: clock.now, items: state.laterOnItems.length }); return id;
    } },
    scripting: { async executeScript(options) {
      if (options.files?.includes("content-metadata.js")) {
        const tab = tabs.find(entry => entry.id === options.target.tabId);
        if (!tab) throw Error("NO_TAB");
        return [{ result: { title: tab.title, description: "Full description", image: "https://save-close.test/cover.png", favicon: "https://save-close.test/icon.png", url: tab.url } }];
      }
      if (Array.isArray(options.args?.[0])) notices.push({ ...clone(options.args[0][0]), at: clock.now, items: state.laterOnItems.length });
      if (options.args?.[0]?.batchId && Array.isArray(options.args[0].pages)) overlays.push({ tabId: options.target.tabId, payload: clone(options.args[0]) });
      return [{ result: controls.pickerAvailable }];
    } }
  };
  const context = createWorkerContext({ chrome, URL, URLSearchParams, Date, Promise, console, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval,
    async fetch() { throw Error("OFFLINE"); } });
  const clock = FakeTimers.withGlobal(context).install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  t.after(() => clock.uninstall());
  vm.runInContext(read("background-test-api.js"), context);
  await clock.tickAsync(0);
  const click = (id = MENU) => [...events.menu][0]({ menuItemId: id }, clone(tabs[0]));
  const send = message => new Promise((resolve, reject) => {
    for (const listener of events.messages) if (listener(message, {}, resolve) === true) return;
    reject(Error("UNHANDLED_MESSAGE"));
  });
  return { state, session, tabs, notices, removed, menus, created, overlays, controls, clock, events, click, send };
}

for (const language of ["zh-CN", "en"]) {
  test(`菜单注册与直接收藏：${language} 提示后固定 800ms 关闭原标签，保留其他标签`, async t => {
    const e = await worker(t, { language });
    assert.deepEqual(e.menus.map(menu => menu.id), ["lateron-save-page", MENU, "lateron-save-all-tabs", SELECTED_MENU]);
    assert.equal(e.menus[1].title, language === "en" ? "Add this page to StaySide and close" : "添加此页面到 StaySide 并关闭");
    assert.deepEqual(e.menus[3].contexts, ["action"]);
    assert.equal(e.menus[3].title, language === "en" ? "Add selected tabs to StaySide" : "添加选中的标签页到 StaySide");
    const initialListeners = e.events.updated.size;
    const completion = e.click(); await e.clock.tickAsync(0);
    assert.equal(e.state.laterOnItems[0].url, URL_A);
    assert.equal(e.notices[0].items, 1, "提示出现前收藏已持久化");
    assert.equal(e.notices[0].kind, "success");
    e.tabs[0].active = false; e.tabs[1].active = true;
    await e.clock.tickAsync(799); assert.equal(e.removed.length, 0);
    await e.clock.tickAsync(1); await completion;
    assert.deepEqual(e.removed, [{ id: 1, at: e.notices[0].at + 800 }]);
    assert.deepEqual(e.tabs.map(tab => tab.id), [2]);
    assert.equal(e.events.updated.size, initialListeners, "关闭后释放临时导航监听");
  });
}

test("收藏选中标签页：锁定菜单来源窗口和触发时的网址，确认后不关闭标签", async t => {
  const e = await worker(t);
  const selectedUrl = "https://save-close.test/selected";
  e.state.laterOnSettings.askFolderOnBatch = false;
  e.controls.currentWindowId = 2;
  const selected = { id: 3, windowId: 1, highlighted: true, title: "Original selection", url: selectedUrl };
  e.tabs.push(selected,
    { id: 4, windowId: 2, active: true, highlighted: true, url: "https://save-close.test/another-window" },
    { id: 5, windowId: 1, highlighted: true, url: "chrome://settings/" });

  const opened = e.click(SELECTED_MENU); await e.clock.tickAsync(200); await opened;
  assert.equal(e.state.laterOnItems.length, 0);
  assert.equal(e.overlays.at(-1).tabId, 1);
  assert.equal(e.overlays.at(-1).payload.titleText, "将选中的 2 个标签页添加到哪个项目？");
  const { batchId } = e.overlays.at(-1).payload;
  e.tabs[1].highlighted = true;
  Object.assign(selected, { highlighted: false, url: "https://save-close.test/navigated", title: "New page" });

  const confirmed = await e.send({ type: "CONFIRM_BATCH_SAVE", batchId, projectId: "work" });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.tabCount, 2);
  await e.clock.tickAsync(0);
  assert.deepEqual(e.state.laterOnItems.map(item => item.url).sort(), [URL_A, selectedUrl].sort());
  assert.equal(e.state.laterOnItems.find(item => item.url === selectedUrl).title, "Original selection");
  assert.ok(e.state.laterOnItems.every(item => item.projectId === "work"));
  assert.deepEqual(e.removed, []);
});

test("收藏选中标签页：无可收藏网页时不回退整窗，受限页面可打开独立选择器", async t => {
  const e = await worker(t, { language: "en" });
  e.tabs[0].url = "chrome://settings/";
  assert.equal((await e.click(SELECTED_MENU)).ok, false);
  assert.equal(e.session.laterOnPendingBatch, undefined);
  assert.equal(e.created.length, 0);
  e.tabs[1].highlighted = true;

  assert.equal((await e.click(SELECTED_MENU)).pending, true);
  const [pickerTab] = e.created;
  assert.equal(pickerTab.windowId, 1);
  const batchId = new URL(pickerTab.url).searchParams.get("batch");
  const picker = await e.send({ type: "GET_PENDING_PICKER", batchId });
  assert.equal(picker.payload.titleText, "Add 1 selected tab to which project?");
  await e.send({ type: "CANCEL_BATCH_SAVE", batchId });
  assert.equal(e.session.laterOnPendingBatch, undefined);
  assert.equal(e.state.laterOnItems.length, 0);
});

test("普通添加不关闭；重复添加并关闭不重复入库", async t => {
  const e = await worker(t);
  await e.click("lateron-save-page"); await e.clock.tickAsync(1500);
  assert.equal(e.removed.length, 0);
  const completion = e.click(); await e.clock.tickAsync(0);
  assert.equal(e.notices.at(-1).kind, "skip");
  await e.clock.tickAsync(800); await completion;
  assert.equal(e.state.laterOnItems.length, 1);
  assert.equal(e.removed[0].id, 1);
});

test("选项目确认后才开始延迟，关闭原标签而非项目选择页", async t => {
  const e = await worker(t, { picker: true, frozen: true });
  await e.click(); await e.clock.tickAsync(2000);
  assert.equal(e.state.laterOnItems.length, 0);
  assert.equal(e.removed.length, 0);
  assert.equal(e.session.laterOnPendingBatch.closeAfterSave.id, 1);
  const batchId = e.session.laterOnPendingBatch.batchId;
  e.tabs[0].active = false;
  e.tabs.push({ id: 99, windowId: 1, active: true, url: e.created[0].url });
  assert.equal((await e.send({ type: "CONFIRM_BATCH_SAVE", batchId, projectId: "work" })).ok, true);
  await e.clock.tickAsync(0);
  assert.equal(e.state.laterOnItems[0].projectId, "work");
  assert.equal(e.notices.at(-1).system, true);
  await e.clock.tickAsync(799); assert.equal(e.removed.length, 0);
  await e.clock.tickAsync(1);
  assert.equal(e.removed[0].id, 1);
  assert.ok(e.tabs.some(tab => tab.id === 99));
});

test("普通页面确认项目后提示并关闭；取消、选项目失败和写入失败均保留标签", async t => {
  for (const mode of ["confirm", "cancel", "picker-failure", "write-failure"]) {
    const e = await worker(t, { picker: true });
    if (mode === "picker-failure") e.controls.pickerAvailable = false;
    const opened = e.click(); await e.clock.tickAsync(200); await opened;
    if (mode !== "picker-failure") {
      const batchId = e.session.laterOnPendingBatch.batchId;
      if (mode === "write-failure") e.controls.failWrite = true;
      await e.send({ type: mode === "cancel" ? "CANCEL_BATCH_SAVE" : "CONFIRM_BATCH_SAVE", batchId, projectId: "work" });
      await e.clock.tickAsync(0);
    }
    await e.clock.tickAsync(1000);
    assert.equal(e.removed.length, mode === "confirm" ? 1 : 0, mode);
    assert.equal(e.state.laterOnItems.length, mode === "confirm" ? 1 : 0, mode);
  }
});

test("直接收藏失败不关闭；关闭失败保留已写入收藏并记录原因", async t => {
  for (const mode of ["write", "close"]) {
    const e = await worker(t); e.controls[mode === "write" ? "failWrite" : "failClose"] = true;
    const completion = e.click(); await e.clock.tickAsync(1000); await completion;
    assert.equal(e.removed.length, 0);
    assert.equal(e.state.laterOnItems.length, mode === "write" ? 0 : 1);
    assert.match(e.state.laterOnDiag.lastError, mode === "write" ? /SAVE_FAILED/ : /已收藏.*CLOSE_FAILED/);
  }
});

test("跳转、待跳转、同页刷新或手动关页期间均不再关闭标签", async t => {
  for (const mode of ["url", "pending", "reload", "away-back", "removed"]) {
    const e = await worker(t); const count = e.events.updated.size;
    const completion = e.click(); await e.clock.tickAsync(0);
    if (mode === "url") e.tabs[0].url = "https://save-close.test/new";
    if (mode === "pending") e.tabs[0].pendingUrl = "https://save-close.test/new";
    if (mode === "reload" || mode === "away-back") {
      e.events.updated.forEach(listener => listener(1, mode === "reload" ? { status: "loading" } : { url: "https://save-close.test/new" }));
    }
    if (mode === "removed") e.tabs.splice(0, 1);
    await e.clock.tickAsync(800); await completion;
    assert.equal(e.removed.length, 0, mode);
    assert.equal(e.state.laterOnItems.length, 1, mode);
    assert.equal(e.events.updated.size, count, mode);
  }
});

test("冻结页直接收藏后通知并关闭；内部页面不能收藏也不关闭", async t => {
  const e = await worker(t, { frozen: true });
  const completion = e.click(); await e.clock.tickAsync(0);
  assert.equal(e.notices[0].system, true);
  await e.clock.tickAsync(800); await completion;
  assert.equal(e.removed[0].id, 1);
  const internal = await worker(t); internal.tabs[0].url = "chrome://settings/";
  await internal.click(); await internal.clock.tickAsync(1500);
  assert.equal(internal.removed.length, 0);
  assert.equal(internal.state.laterOnItems.length, 0);
});
