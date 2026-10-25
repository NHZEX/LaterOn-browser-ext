const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLibraryPage, makeItem } = require("./helpers/library-card-page.cjs");

const params = "?from=sidepanel&project=unfiled&filter=all";
const ready = page => page.until(() => page.card("a"), "首张卡片提交");
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("启动慢读期间的广播覆盖旧快照，随后继续接收跨页更新", async t => {
  const gate = deferred(); let reading = false;
  const page = createLibraryPage(t, { params, configure({ window }) {
    const get = window.chrome.storage.local.get;
    window.chrome.storage.local.get = async keys => {
      const snapshot = await get(keys);
      if (Array.isArray(keys) && keys.includes("laterOnItems")) { reading = true; await gate.promise; }
      return snapshot;
    };
  } });
  await page.until(() => reading, "启动读取挂起");
  page.broadcast({ laterOnItems: [makeItem("b", { title: "External B" })], laterOnSidebarWidth: 340 });
  gate.resolve(); await page.until(() => page.card("b"), "采用更新后的集合");
  assert.equal(page.card("a"), null);
  assert.equal(page.document.querySelector("#sidebarResizer").getAttribute("aria-valuenow"), "340");
  page.broadcast({ laterOnItems: [makeItem("c")] });
  await page.until(() => page.card("c"), "初始化后继续订阅");
  assert.deepEqual(page.ids(), ["c"]);
});

test("初始化读取迟到或卸载后的广播均不能重新挂载界面和监听", async t => {
  const gate = deferred(); let reading = false;
  const page = createLibraryPage(t, { params, configure({ window }) {
    const get = window.chrome.storage.local.get;
    window.chrome.storage.local.get = async keys => {
      const snapshot = await get(keys);
      if (Array.isArray(keys) && keys.includes("laterOnItems")) { reading = true; await gate.promise; }
      return snapshot;
    };
  } });
  await page.until(() => reading, "读取开始");
  const before = page.listenerCounts(); page.unmount(); const after = page.listenerCounts();
  assert.equal(after.messages, before.messages - 1);
  assert.equal(after.storage, before.storage - 1);
  gate.resolve(); await page.flush();
  page.broadcast({ laterOnItems: [makeItem("b")], laterOnCurrentItem: "b" });
  await page.flush(); await page.frame();
  assert.deepEqual(page.listenerCounts(), after);
  assert.deepEqual(page.ids(), []); assert.deepEqual(page.scrolled, []);
});

test("通知按标签过滤，药丸停留 3200ms 并在淡出后卸除；替换通知取消旧定时器", async t => {
  const page = createLibraryPage(t, { params }); await ready(page);
  const toast = page.document.querySelector("#toast");
  assert.deepEqual(page.notice({ type: "SHOW_LIBRARY_NOTICE", tabId: 2, message: "Other tab" }), []);
  assert.equal(toast.textContent, "");
  assert.equal(page.notice({ type: "SHOW_LIBRARY_NOTICE", tabId: 1, message: "Open a web page first" })[0].shown, true);
  await page.flush(); assert.equal(toast.textContent, "Open a web page first");
  assert.ok(toast.classList.contains("pill-toast")); assert.ok(toast.classList.contains("show"));
  await page.clock.tickAsync(3198); assert.ok(toast.classList.contains("show"));
  await page.clock.tickAsync(2); assert.ok(!toast.classList.contains("show")); assert.ok(toast.classList.contains("pill-toast"));
  page.notice({ type: "SHOW_LIBRARY_NOTICE", message: "Replacement" }); await page.flush();
  await page.clock.tickAsync(300); assert.ok(toast.classList.contains("pill-toast")); assert.ok(toast.classList.contains("show"));
  await page.clock.tickAsync(2900); assert.ok(!toast.classList.contains("show"));
  await page.clock.tickAsync(260); assert.ok(!toast.classList.contains("pill-toast"));
  page.unmount(); assert.deepEqual(page.notice({ type: "SHOW_LIBRARY_NOTICE", message: "Late" }), []);
});

test("原文复用排除自身标签，并在原文所在窗口打开侧栏和聚焦", async t => {
  const panels = [], windows = [];
  const page = createLibraryPage(t, { params, configure({ window }) {
    window.chrome.tabs.getCurrent = async () => ({ id: 9, windowId: 7 });
    window.chrome.tabs.query = async query => query.active ? [{ id: 1, windowId: 1 }] : [
      { id: 9, windowId: 7, active: true, url: "https://example.test/a" },
      { id: 5, windowId: 8, active: false, url: "https://www.example.test/a/?utm_source=mail#section" }
    ];
    window.chrome.windows.update = async (id, patch) => windows.push({ id, ...patch });
    window.chrome.sidePanel.open = async options => panels.push(options);
  } });
  await ready(page); page.click('.title-link');
  await page.until(() => page.opened.length, "激活原文");
  assert.deepEqual(page.opened.map(entry => ({ ...entry })), [{ id: 5, active: true }]);
  assert.equal(panels[0].windowId, 8); assert.equal(windows[0].id, 8);
  assert.equal(page.store.laterOnCurrentItem, "a"); assert.ok(page.card("a").classList.contains("is-current"));
});

test("侧栏就绪前不导航，超时后继续；自动在读写入不依赖自身广播", async t => {
  const pings = [];
  const page = createLibraryPage(t, { params, stored: { laterOnSettings: { autoMarkRead: true } }, configure({ window }) {
    const send = window.chrome.runtime.sendMessage;
    window.chrome.runtime.sendMessage = async message => {
      if (message.type === "PING_SIDEPANEL") { pings.push(message); return { ready: false }; }
      return send(message);
    };
  } });
  await ready(page); page.click('.description');
  await page.until(() => pings.length, "等待侧栏");
  assert.deepEqual(page.opened, []); assert.equal(page.store.laterOnItems[0].status, "unread");
  await page.clock.tickAsync(1600); await page.until(() => page.opened.length, "超时仍导航");
  assert.equal(page.opened[0].url, "https://example.test/a");
  assert.equal(page.store.laterOnItems[0].status, "reading"); assert.ok(page.card("a").classList.contains("is-reading"));
});

test("卸载取消侧栏重试和迟到的就绪回调，不能再改阅读状态或导航", async t => {
  const gate = deferred(); let pinged = false;
  const page = createLibraryPage(t, { params, stored: { laterOnSettings: { autoMarkRead: true } }, configure({ window }) {
    const send = window.chrome.runtime.sendMessage;
    window.chrome.runtime.sendMessage = message => {
      if (message.type === "PING_SIDEPANEL") { pinged = true; return gate.promise; }
      return send(message);
    };
  } });
  await ready(page); page.click('.title-link'); await page.until(() => pinged, "就绪请求挂起");
  page.unmount(); gate.resolve({ ready: true }); await page.clock.tickAsync(2000);
  assert.deepEqual(page.opened, []); assert.equal(page.store.laterOnItems[0].status, "unread");
});

test("排序合并最新设置且无广播生效，快捷键和定位帧在卸载时清理", async t => {
  const page = createLibraryPage(t, { params, items: [makeItem("a"), makeItem("b", { savedAt: 1 })] }); await ready(page);
  page.store.laterOnSettings = { ...page.store.laterOnSettings, unrelated: "keep" };
  const sort = page.document.querySelector("#sortSelect");
  sort.value = "oldest"; sort.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  await page.until(() => page.store.laterOnSettings.defaultSort === "oldest", "保存排序");
  assert.equal(page.store.laterOnSettings.unrelated, "keep"); assert.deepEqual(page.ids(), ["b", "a"]);
  page.document.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(page.document.activeElement.id, "searchInput");
  page.broadcast({ laterOnCurrentItem: "b" }); await page.flush();
  const lateFrames = page.pendingFrames(); const before = page.listenerCounts();
  page.unmount(); lateFrames.forEach(callback => callback(0)); await page.frame();
  assert.deepEqual(page.scrolled, []);
  assert.equal(page.listenerCounts().storage, before.storage - 2);
  const event = new page.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
  page.document.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
});
