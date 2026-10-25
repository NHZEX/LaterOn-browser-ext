const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLibraryPage, makeItem } = require("./helpers/library-card-page.cjs");

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
function layout(env) {
  env.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches(".card, .board-card")) {
      const nodes = [...this.parentNode.querySelectorAll(this.matches(".card") ? ".card" : ".board-card")];
      return rect(300 + nodes.indexOf(this) * 220, 100, 200, 200);
    }
    if (this.matches(".project-row")) {
      return rect(20, 100 + [...this.parentNode.querySelectorAll(".project-row")].indexOf(this) * 40, 200, 36);
    }
    return rect(0, 0, 1200, 900);
  };
}
function transfer() {
  const data = new Map();
  return { setData: (type, value) => data.set(type, value), getData: type => data.get(type) || "", get types() { return [...data.keys()]; }, setDragImage() {} };
}
function event(env, target, type, data, x = 310, y = 110) {
  const event = new env.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: data, clientX: x, clientY: y }); target.dispatchEvent(event); return event;
}
async function ready(env, project = "unfiled") {
  await env.until(() => env.document.querySelector("#projectList"), "页面就绪"); layout(env);
  env.click(`.project-nav[data-project="${project}"]`); await env.flush();
}
const row = (env, id) => env.document.querySelector(`.project-row[data-id="${id}"]`);
const board = (env, id) => env.document.querySelector(`.board-card[data-project="${id}"]`);
const projectIds = env => [...env.document.querySelectorAll(".project-row")].map(row => row.dataset.id);
const clean = env => {
  assert.equal(env.document.querySelectorAll(".drag-preview, .drag-home-frame, .folder-drag-preview, .folder-drop-line, .dragging, .is-dragging, .drop-target, .is-reordering, .is-sorting, .no-transition").length, 0);
};
async function cardDrag(env, source = "d", target = "a") {
  const data = transfer(); event(env, env.card(source), "dragstart", data); await env.frame();
  event(env, env.card(target), "dragover", data); return data;
}

test("卡片排序保留阅读筛选隐藏项，并从成功响应更新界面与共享排序偏好", async t => {
  const env = createLibraryPage(t, { items: ["a", "b", "c", "d"].map((id, n) => makeItem(id, { savedAt: 4 - n, status: id === "b" ? "done" : "unread" })) });
  await ready(env); env.broadcast({ laterOnOrder: { unfiled: ["a", "b", "c", "d"] } });
  env.click('.nav-item[data-filter="unread"]'); await env.flush();
  assert.deepEqual(env.ids(), ["a", "c", "d"]);
  const data = await cardDrag(env);
  event(env, env.document.querySelector("#cardGrid"), "drop", data); await env.flush();
  assert.deepEqual(env.store.laterOnOrder.unfiled, ["d", "a", "b", "c"]);
  assert.deepEqual(env.ids(), ["d", "a", "c"]);
  assert.equal(env.store.laterOnSettings.defaultSort, "custom"); clean(env);
});

test("排序失败清理预览并允许重试，写入挂起时重复 drop 不提交", async t => {
  const env = createLibraryPage(t, { items: ["a", "b", "c", "d"].map((id, n) => makeItem(id, { savedAt: 4 - n })) });
  await ready(env); env.failNextWrite("laterOnOrder");
  let data = await cardDrag(env); event(env, env.document.querySelector("#cardGrid"), "drop", data); await env.flush();
  assert.equal(env.store.laterOnOrder, undefined); assert.deepEqual(env.ids(), ["a", "b", "c", "d"]); clean(env);
  const gate = env.holdNextWrite("laterOnOrder");
  data = await cardDrag(env); event(env, env.document.querySelector("#cardGrid"), "drop", data); await gate.started;
  const count = env.commands.length;
  event(env, env.document.querySelector("#cardGrid"), "drop", data);
  assert.equal(event(env, env.card("a"), "dragstart", transfer()).defaultPrevented, true);
  event(env, env.card("d"), "dragend", data); await env.flush(); assert.equal(env.commands.length, count);
  gate.release(); await env.flush(); assert.deepEqual(env.ids(), ["d", "a", "b", "c"]); clean(env);
});

test("项目排序遵守置顶分区和隐藏归档项，图板与侧栏无广播同步", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "hidden", pinned: true, archived: true }, { id: "p", pinned: true }, { id: "a" }, { id: "b" }] });
  await ready(env, "all");
  const data = transfer(); event(env, row(env, "b"), "dragstart", data);
  event(env, env.document.querySelector("#projectList"), "dragover", data, 25, 0);
  event(env, env.document.querySelector("#projectList"), "drop", data); await env.flush();
  assert.deepEqual(env.store.laterOnProjects.map(project => project.id), ["hidden", "p", "b", "a"]);
  assert.deepEqual(projectIds(env), ["p", "b", "a"]);
  assert.deepEqual([...env.document.querySelectorAll(".board-card")].map(board => board.dataset.project), ["p", "b", "a"]); clean(env);
  const boards = transfer(); event(env, board(env, "a"), "dragstart", boards); await env.frame();
  event(env, board(env, "b"), "dragover", boards, 530, 110);
  event(env, env.document.querySelector("#boardGrid"), "drop", boards); await env.flush();
  assert.deepEqual(env.store.laterOnProjects.map(project => project.id), ["hidden", "p", "a", "b"]);
  assert.deepEqual(projectIds(env), ["p", "a", "b"]); clean(env);
});

test("外部更新与 Escape 取消拖动，迟到帧与旧 drop 不能重排", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "a" }, { id: "b" }] }); await ready(env, "all");
  let data = transfer(); event(env, board(env, "b"), "dragstart", data);
  const late = env.pendingFrames(); env.broadcast({ laterOnProjects: [{ id: "b" }, { id: "a" }] }); await env.flush();
  late.forEach(callback => callback(0)); event(env, env.document.querySelector("#boardGrid"), "drop", data); await env.flush(); clean(env);
  assert.equal(env.commands.length, 0);
  data = transfer(); event(env, row(env, "b"), "dragstart", data); event(env, env.document.querySelector("#projectList"), "dragover", data, 25, 999);
  env.broadcast({ laterOnProjects: [{ id: "a" }, { id: "b" }] }); await env.flush();
  event(env, env.document.querySelector("#projectList"), "drop", data); await env.flush(); clean(env); assert.equal(env.commands.length, 0);
  data = transfer(); event(env, board(env, "b"), "dragstart", data); await env.frame();
  env.document.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  event(env, env.document.querySelector("#boardGrid"), "drop", data); await env.flush(); clean(env); assert.equal(env.commands.length, 0);
});

test("拖卡片归类失败保留原归属，重试成功且不触发项目排序", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a")], projects: [{ id: "p", name: "Project" }] }); await ready(env);
  const drag = async () => {
    const data = transfer(); event(env, env.card("a"), "dragstart", data); await env.frame();
    event(env, row(env, "p"), "dragover", data); assert.equal(row(env, "p").classList.contains("drop-target"), true);
    event(env, row(env, "p"), "drop", data); await env.flush();
  };
  env.failNextWrite(); await drag(); assert.equal(env.store.laterOnItems[0].projectId, null); clean(env);
  await drag(); assert.equal(env.store.laterOnItems[0].projectId, "p"); assert.deepEqual(env.ids(), []); clean(env);
  assert.equal(env.commands.some(command => command.action === "moveProject"), false);
});

test("卸载回收拖动监听与迟到排序响应，成功写入仍由协调器完成", async t => {
  const env = createLibraryPage(t, { items: ["a", "b", "c", "d"].map((id, n) => makeItem(id, { savedAt: 4 - n })) }); await ready(env);
  const gate = env.holdNextWrite("laterOnOrder"); const data = await cardDrag(env);
  const grid = env.document.querySelector("#cardGrid"), source = env.card("d");
  event(env, grid, "drop", data); await gate.started;
  env.document.querySelector("#app").__vue_app__.unmount(); clean(env);
  const count = env.commands.length; gate.release(); await env.flush();
  assert.deepEqual(env.store.laterOnOrder.unfiled, ["d", "a", "b", "c"]);
  event(env, source, "dragstart", transfer()); event(env, grid, "drop", data); await env.flush();
  assert.equal(env.commands.length, count); assert.equal(env.store.laterOnSettings.defaultSort, "newest"); clean(env);
});

test("侧栏宽度保留窄屏前偏好，卸载取消捕获并移除控件和广播监听", async t => {
  const env = createLibraryPage(t); await ready(env);
  const handle = env.document.querySelector("#sidebarResizer"), workspace = env.document.querySelector(".workspace");
  const width = () => Number(handle.getAttribute("aria-valuenow"));
  let captured = false;
  handle.setPointerCapture = () => { captured = true; }; handle.hasPointerCapture = () => captured; handle.releasePointerCapture = () => { captured = false; };
  const pointer = (type, x) => {
    const event = new env.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
    Object.defineProperty(event, "pointerId", { value: 1 }); handle.dispatchEvent(event);
  };
  env.broadcast({ laterOnSidebarWidth: 400 }); assert.equal(width(), 400);
  env.window.innerWidth = 700; env.window.dispatchEvent(new env.window.Event("resize")); assert.equal(width(), 340);
  env.window.innerWidth = 1400; env.window.dispatchEvent(new env.window.Event("resize")); assert.equal(width(), 400);
  pointer("pointerdown", 400); pointer("pointermove", 360); assert.equal(width(), 360);
  env.broadcast({ laterOnSidebarWidth: 280 }); assert.equal(width(), 360, "拖动时不接受外部宽度");
  env.document.querySelector("#app").__vue_app__.unmount(); assert.equal(captured, false);
  assert.equal(env.document.body.classList.contains("is-resizing-sidebar"), false); assert.equal(width(), 400);
  const count = env.writes.length, style = workspace.style.cssText;
  handle.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  env.broadcast({ laterOnSidebarWidth: 240 }); env.window.dispatchEvent(new env.window.Event("resize"));
  pointer("pointermove", 420); pointer("pointerup", 420); await env.flush();
  assert.equal(env.writes.length, count); assert.equal(workspace.style.cssText, style);
});
