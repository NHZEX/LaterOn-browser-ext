const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLibraryPage, makeItem } = require("./helpers/library-card-page.cjs");
const dialog = env => env.document.querySelector(".lod-root:not([hidden])");
const field = (env, name) => dialog(env).querySelector(`[data-field="${name}"]`);
const mutations = env => env.commands.filter(command => command.action === "mutateItems");
const shadow = env => env.document.querySelector("#lateron-folder-picker")?.shadowRoot;
const project = (env, id = "p") => env.store.laterOnProjects.find(entry => entry.id === id);
const projectRow = (env, id = "p") => env.document.querySelector(`.project-row[data-id="${id}"]`);
async function ready(env, scope = "all") {
  await env.until(() => env.document.querySelector('.project-nav[data-project="unfiled"]'), "导航挂载");
  env.click(`.project-nav[data-project="${scope}"]`); await env.flush();
}
async function opened(env) { await env.until(() => dialog(env), "弹窗打开"); await env.frame(); }
async function settle(env) { await env.clock.tickAsync(280); await env.flush(); }
async function submit(env, ok = true) { dialog(env).querySelector(ok ? ".lod-ok" : ".lod-cancel").click(); await settle(env); }
async function menu(env, action, id = "p") {
  projectRow(env, id).querySelector(".project-more").click(); await env.flush();
  env.click(`#libraryContextMenu [data-action="${action}"]`); await env.flush();
}
function key(env, element, value) { element.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); }

test("编辑期间外部更新保留草稿、焦点和光标；仅提交修改字段，无自身广播也更新卡片", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a", { image: "local://a" })], covers: { a: "old-cover" } });
  await ready(env, "unfiled");
  const trigger = env.card("a").querySelector(".edit"); trigger.focus(); trigger.click(); await opened(env);
  const title = field(env, "title"); title.value = "My title"; title.focus(); title.setSelectionRange(2, 5);
  env.broadcast({ laterOnItems: [makeItem("a", { title: "External title", description: "External summary", image: "local://a", status: "reading" })],
    laterOnCovers: { a: "new-external-cover" } }); await env.flush();
  assert.equal(field(env, "title"), title); assert.equal(title.value, "My title");
  assert.equal(env.document.activeElement, title); assert.deepEqual([title.selectionStart, title.selectionEnd], [2, 5]);
  await submit(env);
  assert.deepEqual(mutations(env).at(-1).patch, { title: "My title", titleEdited: true });
  assert.equal(env.store.laterOnItems[0].description, "External summary"); assert.equal(env.store.laterOnItems[0].status, "reading");
  assert.equal(env.store.laterOnCovers.a, "new-external-cover");
  assert.equal(env.card("a").querySelector("h2").textContent, "My title"); assert.equal(env.document.activeElement, trigger);
  trigger.click(); await opened(env); field(env, "title").value = "Cancelled"; await submit(env, false);
  assert.equal(mutations(env).length, 1); assert.equal(env.document.activeElement, trigger);
});

test("弹窗目标被外部删除后不复活；确认删除失败后可重试且清理封面与顺序", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b")], covers: { a: "cover-a", b: "cover-b" }, current: "a" });
  await ready(env, "unfiled");
  env.card("a").querySelector(".edit").click(); await opened(env); field(env, "title").value = "Stale";
  env.broadcast({ laterOnItems: [makeItem("b")] }); await env.flush(); await submit(env);
  assert.equal(mutations(env).length, 0); assert.equal(env.document.activeElement.id, "searchInput");
  env.broadcast({ laterOnItems: [makeItem("a"), makeItem("b")], laterOnOrder: { all: ["a", "b"], unfiled: ["b", "a"] } }); await env.flush();
  env.card("a").querySelector(".delete").click(); await opened(env); await submit(env, false);
  assert.equal(mutations(env).length, 0);
  env.card("a").querySelector(".delete").click(); await opened(env); env.failNextWrite(); await submit(env);
  assert.equal(env.store.laterOnItems.length, 2); assert.equal(env.store.laterOnCovers.a, "cover-a"); assert.ok(env.card("a"));
  env.card("a").querySelector(".delete").click(); await opened(env); await submit(env);
  assert.equal(env.card("a"), null); assert.equal(env.store.laterOnCovers.a, undefined); assert.equal(env.store.laterOnCovers.b, "cover-b");
  assert.deepEqual(env.store.laterOnOrder, { all: ["b"], unfiled: ["b"] }); assert.equal(env.store.laterOnCurrentItem, null);
  assert.equal(env.document.activeElement.id, "searchInput");
});

test("项目编辑保留并发简介和新项目，组合封面按选择顺序保存，自动封面不固化", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project", note: "Old" }], items: [
    makeItem("a", { projectId: "p", image: "https://example.test/a.jpg" }), makeItem("b", { projectId: "p", image: "https://example.test/b.jpg" })] });
  await ready(env); env.click('.board-card[data-project="p"] .board-edit'); await opened(env);
  const name = field(env, "name"); name.value = "Renamed"; name.focus(); name.setSelectionRange(1, 4);
  env.broadcast({ laterOnProjects: [{ id: "p", name: "Project", note: "External note" }, { id: "other", name: "Other" }] }); await env.flush();
  assert.equal(field(env, "name"), name); assert.equal(env.document.activeElement, name); assert.equal(name.selectionStart, 1);
  const candidates = [...dialog(env).querySelectorAll(".lod-pick")]; candidates[1].click(); candidates[0].click();
  await submit(env);
  assert.equal(project(env).name, "Renamed"); assert.equal(project(env).note, "External note"); assert.equal(project(env).cover, undefined);
  assert.deepEqual(project(env).coverPick, ["b", "a"]); assert.equal(env.store.laterOnProjects.length, 2);
  assert.equal(projectRow(env).querySelector(".project-name").textContent, "Renamed");
  assert.equal(env.document.querySelector('.board-card[data-project="p"] .board-note').textContent, "External note");
  assert.deepEqual(env.commands.at(-1).changes, { name: "Renamed", coverPick: ["b", "a"] });
});

test("项目编辑失败不更新图板，重新编辑可保存；重名不会写入", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project" }, { id: "q", name: "Other" }], items: [] });
  await ready(env); env.click('.board-card[data-project="p"] .board-edit'); await opened(env);
  field(env, "name").value = "Other"; await submit(env); assert.equal(env.commands.length, 0);
  env.click('.board-card[data-project="p"] .board-edit'); await opened(env);
  field(env, "note").value = "Written note"; env.failNextWrite("laterOnProjects"); await submit(env);
  assert.equal(project(env).note, undefined); assert.notEqual(env.document.querySelector('.board-card[data-project="p"] .board-note').textContent, "Written note");
  env.click('.board-card[data-project="p"] .board-edit'); await opened(env); field(env, "note").value = "Written note"; await submit(env);
  assert.equal(project(env).note, "Written note"); assert.equal(env.document.querySelector('.board-card[data-project="p"] .board-note').textContent, "Written note");
});

test("新建项目取消、失败重试及重复名称复用，并从响应进入项目", async t => {
  const env = createLibraryPage(t, { items: [] }); await ready(env);
  env.click(".board-create"); await opened(env); field(env, "name").value = "Cancelled"; await submit(env, false);
  assert.equal(env.commands.length, 0);
  env.click(".board-create"); await opened(env); field(env, "name").value = "Created"; env.failNextWrite("laterOnProjects"); await submit(env);
  assert.equal(env.store.laterOnProjects.length, 0);
  env.click(".board-create"); await opened(env); field(env, "name").value = "  Created  "; await submit(env);
  const id = env.store.laterOnProjects[0].id;
  assert.equal(env.store.laterOnActiveProject, id); assert.equal(projectRow(env, id).querySelector(".project-name").textContent, "Created");
  await ready(env); env.click(".board-create"); await opened(env); field(env, "name").value = "Created"; await submit(env);
  assert.equal(env.store.laterOnProjects.length, 1); assert.equal(env.store.laterOnActiveProject, id);
});

test("就地重命名失败恢复草稿可重试；Escape 不被 blur 提交，保留并发字段和焦点", async t => {
  const env = createLibraryPage(t, { items: [], projects: [{ id: "p", name: "Project" }] }); await ready(env, "p");
  key(env, env.document.body, "F2"); await env.flush();
  const input = env.document.querySelector(".project-rename"); input.value = "Retry name"; input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  env.broadcast({ laterOnProjects: [{ id: "p", name: "Project", note: "External" }] }); await env.flush();
  assert.equal(env.document.querySelector(".project-rename"), input); assert.equal(env.document.activeElement, input);
  env.failNextWrite("laterOnProjects"); key(env, input, "Enter"); await env.flush();
  const retry = env.document.querySelector(".project-rename"); assert.ok(retry); assert.equal(retry.value, "Retry name"); assert.equal(env.document.activeElement, retry);
  key(env, retry, "Enter"); await env.flush();
  assert.equal(project(env).name, "Retry name"); assert.equal(project(env).note, "External");
  assert.equal(env.document.activeElement, projectRow(env).querySelector(".project-nav"));
  key(env, env.document.body, "F2"); await env.flush(); const cancelled = env.document.querySelector(".project-rename");
  cancelled.value = "Cancelled"; cancelled.dispatchEvent(new env.window.Event("input", { bubbles: true })); key(env, cancelled, "Escape"); await env.flush();
  cancelled.dispatchEvent(new env.window.Event("blur")); await env.flush();
  assert.equal(project(env).name, "Retry name"); assert.equal(env.commands.filter(command => command.action === "updateProject").length, 2);
  assert.equal(env.document.activeElement, projectRow(env).querySelector(".project-nav"));
});

test("置顶和归档失败保持原状态可重试，恢复项目与导航无自身广播也同步", async t => {
  const env = createLibraryPage(t, { items: [], projects: [{ id: "p", name: "Project" }] }); await ready(env);
  env.failNextWrite("laterOnProjects"); await menu(env, "pin"); assert.equal(project(env).pinned, undefined);
  await menu(env, "pin"); assert.equal(project(env).pinned, true); assert.ok(projectRow(env).classList.contains("is-pinned"));
  env.failNextWrite("laterOnProjects"); await menu(env, "archive"); assert.equal(project(env).archived, undefined); assert.ok(projectRow(env));
  await menu(env, "archive"); assert.equal(project(env).archived, true); assert.equal(projectRow(env), null); assert.equal(env.store.laterOnActiveProject, "archive");
  env.document.querySelector('.board-card[data-project="p"]').dispatchEvent(new env.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await env.flush(); env.click('#libraryContextMenu [data-action="archive"]'); await env.flush();
  assert.equal(project(env).archived, false); assert.ok(projectRow(env)); assert.equal(env.store.laterOnActiveProject, "p");
});

test("删除项目使用确认时最新集合，失败可重试，清理项目、封面、顺序和当前阅读位置", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project" }], items: [makeItem("a", { projectId: "p" }), makeItem("b")],
    covers: { a: "cover-a", b: "cover-b" }, current: "a" }); await ready(env, "p");
  await menu(env, "delete"); await opened(env); await submit(env, false); assert.ok(project(env));
  await menu(env, "delete"); await opened(env); env.failNextWrite(); await submit(env); assert.ok(project(env)); assert.equal(env.store.laterOnItems.length, 2);
  await menu(env, "delete"); await opened(env);
  env.broadcast({ laterOnItems: [makeItem("a", { projectId: "p" }), makeItem("b", { projectId: "p" }), makeItem("new")],
    laterOnOrder: { all: ["a", "b", "new"], p: ["a", "b"] } }); await env.flush(); await submit(env);
  assert.equal(project(env), undefined); assert.deepEqual(env.store.laterOnItems.map(item => item.id), ["new"]); assert.equal(env.store.laterOnCurrentItem, null);
  assert.deepEqual(env.store.laterOnCovers, {}); assert.deepEqual(env.store.laterOnOrder, { all: ["new"] });
  assert.equal(env.store.laterOnActiveProject, "all"); assert.equal(projectRow(env), null); assert.match(env.document.querySelector("#toast").textContent, /2/);
});

test("单篇移动失败留在真实浮层可重试；外部删除和卸载后旧浮层不再写入", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project" }], items: [makeItem("a"), makeItem("b")] }); await ready(env, "unfiled");
  env.card("a").querySelector(".project-select").click(); await env.flush(); const picker = shadow(env);
  [...picker.querySelectorAll(".lon-folder")].find(row => row.textContent.includes("Project")).click(); env.failNextWrite(); picker.querySelector(".lon-primary").click(); await env.flush();
  assert.equal(env.store.laterOnItems[0].projectId, null); assert.ok(shadow(env)); assert.equal(picker.querySelector(".lon-primary").disabled, false);
  picker.querySelector(".lon-primary").click(); await settle(env);
  assert.equal(env.store.laterOnItems[0].projectId, "p"); assert.equal(env.card("a"), null); assert.equal(projectRow(env).querySelector(".nav-count").textContent, "1");
  env.card("b").querySelector(".project-select").click(); await env.flush(); const stale = shadow(env);
  env.broadcast({ laterOnItems: [makeItem("a", { projectId: "p" })] }); await settle(env);
  assert.equal(shadow(env), undefined); const before = env.commands.length;
  stale.querySelector(".lon-primary").click(); await env.flush(); assert.equal(env.commands.length, before);
  await ready(env, "p"); env.card("a").querySelector(".project-select").click(); await env.flush(); const unmounted = shadow(env);
  env.document.querySelector("#app").__vue_app__.unmount(); await settle(env);
  unmounted.querySelector(".lon-primary").click(); await env.flush(); assert.equal(env.commands.length, before);
});

test("卸载关闭编辑弹窗并阻止其结果提交，已发出命令的迟到响应不再更新页面", async t => {
  const env = createLibraryPage(t); await ready(env, "unfiled"); env.card("a").querySelector(".edit").click(); await opened(env);
  field(env, "title").value = "Unmounted"; env.document.querySelector("#app").__vue_app__.unmount(); await settle(env);
  assert.equal(dialog(env), null); assert.equal(env.commands.length, 0); assert.equal(env.store.laterOnItems[0].title, "Title a");
  const pending = createLibraryPage(t); await ready(pending, "unfiled");
  const gate = pending.holdNextWrite(); pending.card("a").querySelector(".read-toggle").click(); await gate.started;
  pending.card("a").querySelector(".read-toggle").click(); await pending.flush(); assert.equal(mutations(pending).length, 1);
  pending.document.querySelector("#app").__vue_app__.unmount(); gate.release(); await pending.flush();
  assert.equal(pending.store.laterOnItems[0].status, "done"); assert.equal(pending.card("a"), null);
});

test("弹窗排队显示前卸载仍会关闭；项目编辑和删除确认期间外部移除目标不再发命令", async t => {
  const queued = createLibraryPage(t, { items: [] }); await ready(queued);
  queued.click(".board-create"); queued.document.querySelector("#app").__vue_app__.unmount(); await settle(queued);
  assert.equal(dialog(queued), null); assert.equal(queued.commands.length, 0);
  const env = createLibraryPage(t, { items: [], projects: [{ id: "p", name: "Project" }] }); await ready(env);
  env.click('.board-card[data-project="p"] .board-edit'); await opened(env); field(env, "note").value = "Stale note";
  env.broadcast({ laterOnProjects: [] }); await env.flush(); await submit(env);
  assert.equal(env.commands.length, 0); assert.deepEqual(env.store.laterOnProjects, []);
  env.broadcast({ laterOnProjects: [{ id: "p", name: "Project" }] }); await env.flush();
  await menu(env, "delete"); await opened(env); env.broadcast({ laterOnProjects: [] }); await env.flush(); await submit(env);
  assert.equal(env.commands.length, 0); assert.deepEqual(env.store.laterOnProjects, []);
});
