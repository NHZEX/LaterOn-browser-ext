const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage, makeItem, makeStore } = require("./helpers/panel-page.cjs");
const dialog = env => env.document.querySelector(".lod-root:not([hidden])");
const field = (env, name) => dialog(env).querySelector(`[data-field="${name}"]`);
const ids = env => [...env.document.querySelectorAll("#items .item")].map(item => item.dataset.id);
async function ready(env) { await env.until(() => env.item("a"), "侧栏初始化"); }
async function openDialog(env, action = "edit", id = "a") {
  const trigger = env.item(id).querySelector(`.${action}`); trigger.focus(); env.click(trigger);
  await env.until(() => dialog(env), "真实弹窗"); await env.frame(); return trigger;
}
async function submit(env, ok = true) { env.click(dialog(env).querySelector(ok ? ".lod-ok" : ".lod-cancel")); await env.clock.tickAsync(280); }
function key(env, element, key, extra = {}) { element.dispatchEvent(new env.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })); }
function track(env) {
  const calls = [], original = env.window.chrome.runtime.sendMessage;
  env.window.chrome.runtime.sendMessage = async message => { if (message.type === "COLLECTION_COMMAND") calls.push(structuredClone(message)); return original(message); };
  return calls;
}
function hold(env, action, afterWrite = false) {
  const original = env.window.chrome.runtime.sendMessage;
  let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  env.window.chrome.runtime.sendMessage = async message => {
    if (message.type !== "COLLECTION_COMMAND" || message.action !== action) return original(message);
    entered = true;
    if (afterWrite) { const response = await original(message); await gate; return response; }
    await gate; return original(message);
  };
  return { release, entered: () => entered };
}
function dragEvent(env, type, target, x = 10, y = 10) {
  const event = new env.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  event.dataTransfer = { setData() {}, setDragImage() {} }; target.dispatchEvent(event); return event;
}
function layout(env, grid = false) {
  [...env.document.querySelectorAll("#items .item")].forEach((element, index) => {
    const left = grid ? index % 2 * 160 : 0, top = (grid ? Math.floor(index / 2) : index) * 110;
    element.getBoundingClientRect = () => ({ left, right: left + 150, top, bottom: top + 100, width: 150, height: 100 });
  });
}
function reorder(env, id = "c", x = 10, y = 10) {
  dragEvent(env, "dragstart", env.item(id)); dragEvent(env, "dragover", env.document.querySelector("#items"), x, y);
  dragEvent(env, "drop", env.document.querySelector("#items"), x, y);
}
const store = () => ({ ...makeStore([makeItem({ id: "a", savedAt: 3 }), makeItem({ id: "b", savedAt: 2 }),
  makeItem({ id: "c", savedAt: 1 }), makeItem({ id: "hidden", savedAt: 0, status: "done" })]),
  laterOnActiveProject: "unfiled", laterOnSettings: { autoMarkRead: false }, laterOnCovers: { a: "old-cover", b: "other-cover" } });

test("侧栏编辑仅写改动字段，保留并发摘要/封面和草稿焦点；取消及无改动不写入", async t => {
  const env = createPanelPage(t, { store: store() }); await ready(env); const calls = track(env);
  const trigger = await openDialog(env);
  const input = field(env, "title"); input.value = "My title"; input.focus(); input.setSelectionRange(1, 4);
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => item.id === "a" ? { ...item, description: "External summary", status: "reading" } : item),
    laterOnCovers: { a: "external-cover", b: "other-cover" } }); await env.flush();
  assert.equal(field(env, "title"), input); assert.equal(input.value, "My title"); assert.equal(env.document.activeElement, input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 4]); await submit(env);
  assert.deepEqual(calls.at(-1).patch, { title: "My title", titleEdited: true });
  assert.equal(env.store.laterOnItems[0].description, "External summary"); assert.equal(env.store.laterOnItems[0].status, "reading");
  assert.equal(env.store.laterOnCovers.a, "external-cover"); assert.equal(env.item("a").querySelector("h2").textContent, "My title");
  assert.equal(env.document.activeElement, trigger);
  await openDialog(env); await submit(env); assert.equal(calls.length, 1);
  await openDialog(env); field(env, "title").value = "Cancelled"; await submit(env, false); assert.equal(calls.length, 1);
});

test("侧栏编辑/删除失败可重试，无自身广播清理卡片、封面、当前标记和顺序", async t => {
  const env = createPanelPage(t, { store: { ...store(), laterOnCurrentItem: "a", laterOnOrder: { unfiled: ["a", "b", "c"] } } }); await ready(env);
  await openDialog(env); field(env, "title").value = "Retry"; env.failNextWrite(); await submit(env);
  assert.notEqual(env.item("a").querySelector("h2").textContent, "Retry");
  await openDialog(env); field(env, "title").value = "Retry"; await submit(env);
  assert.equal(env.item("a").querySelector("h2").textContent, "Retry");
  await openDialog(env, "delete"); await submit(env, false); assert.ok(env.item("a"));
  await openDialog(env, "delete"); env.failNextWrite(); await submit(env); assert.ok(env.item("a")); assert.equal(env.store.laterOnCovers.a, "old-cover");
  await openDialog(env, "delete"); await submit(env);
  assert.equal(env.item("a"), null); assert.equal(env.store.laterOnCovers.a, undefined); assert.equal(env.store.laterOnCovers.b, "other-cover");
  assert.deepEqual(env.store.laterOnOrder.unfiled, ["b", "c"]); assert.equal(env.store.laterOnCurrentItem, null);
  assert.equal(env.document.activeElement.id, "searchInput");
});

test("外部删除编辑目标不复活；挂起写入阻止重复命令，卸载忽略迟到响应", async t => {
  const env = createPanelPage(t, { store: store() }); await ready(env); const calls = track(env);
  await openDialog(env); field(env, "title").value = "Stale";
  env.broadcast({ laterOnItems: env.store.laterOnItems.filter(item => item.id !== "a") }); await submit(env);
  assert.equal(calls.length, 0); assert.equal(env.document.activeElement.id, "searchInput");
  const pending = hold(env, "mutateItems", true);
  env.click(env.item("b").querySelector(".read-toggle")); await env.until(pending.entered, "挂起成功响应");
  env.click(env.item("b").querySelector(".read-toggle")); await env.flush(); assert.equal(calls.length, 1);
  env.window.dispatchEvent(new env.window.Event("pagehide")); pending.release(); await env.flush();
  assert.equal(env.count(), 0, "卸载后不能从响应重新挂载卡片"); assert.equal(env.store.laterOnItems.find(item => item.id === "b").status, "done");
});

test("编辑弹窗显示前卸载不遗留浮层或写入；加载失败后可重新加载确认框", async t => {
  const env = createPanelPage(t, { store: store() }); await ready(env);
  const api = env.window.LaterOnDialog; env.window.LaterOnDialog = undefined;
  env.click(env.item("a").querySelector(".delete"));
  env.document.querySelector('script[src="dialog.js"]').dispatchEvent(new env.window.Event("error")); await env.flush();
  assert.ok(env.item("a"));
  env.click(env.item("a").querySelector(".delete"));
  env.window.LaterOnDialog = api;
  env.document.querySelector('script[src="dialog.js"]').dispatchEvent(new env.window.Event("load")); await env.flush();
  await env.until(() => dialog(env), "加载失败后重试确认"); await submit(env, false);
  env.click(env.item("a").querySelector(".edit")); env.window.dispatchEvent(new env.window.Event("pagehide"));
  await env.flush(); assert.equal(dialog(env), null); assert.equal(env.store.laterOnItems.length, 4);
});

test("Vue 侧栏菜单支持键盘、焦点移交、外部更新/删除及关闭生命周期", async t => {
  const env = createPanelPage(t, { store: store() }); await ready(env);
  const link = env.item("a").querySelector(".open-item"); link.focus(); key(env, link, "F10", { shiftKey: true });
  await env.until(() => env.document.querySelector('[role="menu"]'), "键盘菜单"); await env.flush();
  const entries = () => [...env.document.querySelectorAll('[role="menuitem"]')];
  assert.equal(env.document.activeElement, entries()[0]);
  key(env, entries()[0], "ArrowUp"); assert.equal(env.document.activeElement, entries()[2]);
  key(env, entries()[2], "Home"); assert.equal(env.document.activeElement, entries()[0]);
  key(env, entries()[0], "End"); assert.equal(env.document.activeElement, entries()[2]);
  key(env, entries()[2], "Escape"); await env.flush(); assert.equal(env.document.activeElement, link);
  key(env, link, "ContextMenu"); await env.flush(); env.click(entries()[1]);
  await env.until(() => dialog(env), "菜单移交编辑焦点"); await env.frame(); assert.equal(env.document.activeElement, field(env, "title"));
  await submit(env, false); assert.equal(env.document.activeElement, link);
  for (const event of [new env.window.Event("resize"), new env.window.Event("blur"), new env.window.Event("scroll")]) {
    key(env, link, "ContextMenu"); await env.flush();
    (event.type === "scroll" ? env.document : env.window).dispatchEvent(event); await env.flush();
    assert.equal(env.document.querySelector('[role="menu"]'), null);
  }
  key(env, link, "ContextMenu"); await env.flush();
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => item.id === "a" ? { ...item, title: "External" } : item) }); await env.flush();
  assert.equal(env.document.querySelector('[role="menu"]').getAttribute("aria-label"), "External");
  env.broadcast({ laterOnItems: env.store.laterOnItems.filter(item => item.id !== "a") }); await env.flush();
  assert.equal(env.document.querySelector('[role="menu"]'), null); assert.equal(env.document.activeElement.id, "searchInput");
});

test("侧栏真实点击复用跨窗冻结原文，自动标在读；打开失败和危险链接不改状态", async t => {
  const activated = [], windows = [], opened = [], panels = [];
  const env = createPanelPage(t, { store: { ...store(), laterOnSettings: { autoMarkRead: true } }, setup(window) {
    window.chrome.tabs.query = async query => query.active ? [{ id: 1, windowId: 7, url: "https://current.com" }] : [
      { id: 12, windowId: 8, url: "chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=X&pos=0&uri=https://x.com" }];
    window.chrome.tabs.update = async (id, options) => { activated.push({ id, ...options }); };
    window.chrome.windows.update = async (id, options) => { windows.push({ id, ...options }); };
    window.chrome.tabs.create = async options => { opened.push(options); throw Error("blocked"); };
    window.chrome.sidePanel = { open: async options => { panels.push(structuredClone(options)); } };
  } }); await ready(env);
  env.click(env.item("a").querySelector(".open-item"));
  await env.until(() => panels.length === 1, "复用原文标签并打开跨窗侧栏");
  assert.deepEqual(activated, [{ id: 12, active: true }]); assert.deepEqual(windows, [{ id: 8, focused: true }]);
  assert.deepEqual(panels, [{ windowId: 8 }]); assert.deepEqual(opened, []);
  assert.equal(env.store.laterOnItems[0].status, "reading"); assert.equal(env.store.laterOnCurrentItem, "a");
  assert.equal(env.item("a").classList.contains("is-reading"), true); assert.equal(env.item("a").classList.contains("is-current"), true);
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => item.id === "b" ? { ...item, url: "https://new.test" } : item) });
  await env.flush(); env.click(env.item("b").querySelector(".open-item")); await env.until(() => opened.length === 1, "新标签失败");
  await env.flush(); assert.equal(env.store.laterOnItems.find(item => item.id === "b").status, "unread");
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => item.id === "b" ? { ...item, url: "javascript:alert(1)" } : item) });
  await env.flush(); env.click(env.item("b").querySelector(".open-item")); await env.flush(); assert.equal(opened.length, 1);
});

test("侧栏拖拽失败可重试、保留隐藏条目；挂起提交固定范围并阻止重复 drop", async t => {
  const initial = store(); initial.laterOnProjects = [{ id: "p", name: "Project P" }];
  initial.laterOnItems.push(makeItem({ id: "p-item", projectId: "p" }));
  const env = createPanelPage(t, { store: initial }); await ready(env); const calls = track(env); layout(env);
  const set = env.window.chrome.storage.local.set; let fail = true;
  env.window.chrome.storage.local.set = async patch => { if (fail && patch.laterOnOrder) { fail = false; throw Error("write failed"); } return set(patch); };
  reorder(env); await env.until(() => !env.document.querySelector(".card-drag-preview"), "失败清理");
  assert.deepEqual(ids(env), ["a", "b", "c"]);
  layout(env); const pending = hold(env, "moveItem"); reorder(env);
  await env.until(pending.entered, "排序写入挂起");
  dragEvent(env, "drop", env.document.querySelector("#items"));
  assert.equal(calls.filter(call => call.action === "moveItem").length, 1, "第二次真实命令尚在边界等待");
  env.broadcast({ laterOnActiveProject: "p" }); await env.flush(); assert.deepEqual(ids(env), ["p-item"]);
  pending.release(); await env.until(() => env.store.laterOnSettings.defaultSort === "custom", "自定义排序持久化");
  assert.equal(calls.filter(call => call.action === "moveItem").length, 2);
  assert.deepEqual(env.store.laterOnOrder.unfiled, ["c", "a", "b", "hidden"]); assert.equal(env.store.laterOnOrder.p, undefined);
  assert.deepEqual(ids(env), ["p-item"], "旧排序响应不改变当前项目");
  env.click(env.document.querySelector('[data-project="unfiled"]')); await env.flush(); assert.deepEqual(ids(env), ["c", "a", "b"]);
  assert.equal(env.document.querySelector(".card-drag-preview"), null);
});

test("拖拽宽栏左右半区、窄栏上下半区；外部更新/取消/卸载移除变换与迟到帧", async t => {
  const opened = [];
  const env = createPanelPage(t, { store: store(), setup(window) { window.chrome.tabs.create = async options => { opened.push(options); return { id: 9 }; }; } });
  await ready(env); layout(env, true); reorder(env, "c", 140, 10);
  await env.until(() => env.store.laterOnOrder?.unfiled, "宽栏向右半区放置");
  assert.deepEqual(ids(env), ["a", "c", "b"]);
  env.click(env.item("c").querySelector(".open-item")); await env.flush(); assert.equal(opened.length, 0, "拖后不误开文章");
  await env.clock.tickAsync(251);
  for (const cancel of [() => key(env, env.document, "Escape"), () => env.window.dispatchEvent(new env.window.Event("blur")),
    () => env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => ({ ...item, title: "Updated" })) })]) {
    layout(env); dragEvent(env, "dragstart", env.item("b")); const late = env.pendingFrames();
    dragEvent(env, "dragover", env.document.querySelector("#items")); cancel(); await env.flush();
    late.forEach(callback => callback(0));
    assert.equal(env.document.querySelector(".card-drag-preview"), null);
    assert.equal(env.document.querySelector(".dragging"), null); assert.ok([...env.document.querySelectorAll("#items .item")].every(item => item.style.transform === ""));
  }
  layout(env); dragEvent(env, "dragstart", env.item("b")); env.window.dispatchEvent(new env.window.Event("pagehide"));
  await env.flush(); assert.equal(env.document.querySelector(".card-drag-preview"), null);
});

test("排序提交后卸载仍保存自定义偏好，迟到响应与设置读取不能复活页面", async t => {
  for (const delay of ["command", "settings"]) {
    const env = createPanelPage(t, { store: store() }); await ready(env); layout(env);
    let release, entered = false;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = delay === "command" ? hold(env, "moveItem", true) : null;
    const get = env.window.chrome.storage.local.get;
    if (delay === "settings") env.window.chrome.storage.local.get = async keys => {
      if (keys === "laterOnSettings") { entered = true; await gate; }
      return get(keys);
    };
    reorder(env);
    await env.until(() => pending ? env.store.laterOnOrder?.unfiled : entered, "排序已提交、响应或偏好读取挂起");
    env.window.dispatchEvent(new env.window.Event("pagehide"));
    if (pending) pending.release(); else release();
    await env.until(() => env.store.laterOnSettings.defaultSort === "custom", "卸载后完成已提交排序的偏好保存");
    assert.equal(env.count(), 0); assert.deepEqual(env.store.laterOnOrder.unfiled, ["c", "a", "b", "hidden"]);
  }
});
