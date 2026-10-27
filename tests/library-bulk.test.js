const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLibraryPage, makeItem } = require("./helpers/library-card-page.cjs");
const count = env => env.document.querySelector("#bulkCount").textContent;
const selected = (env, id) => env.card(id)?.querySelector(".select-check").checked;
const mutations = env => env.commands.filter(command => command.action === "mutateItems");
async function inbox(env) {
  await env.until(() => env.document.querySelector('.project-nav[data-project="unfiled"]'), "导航就绪");
  env.click('.project-nav[data-project="unfiled"]'); await env.flush();
}
async function pick(env, ...ids) {
  if (env.document.querySelector("#selectMode").getAttribute("aria-pressed") !== "true") env.click("#selectMode");
  await env.flush();
  assert.equal(env.document.querySelector("#bulkBar").hasAttribute("inert"), false);
  for (const id of ids) { env.card(id).querySelector(".title-link").click(); await env.flush(); }
}
async function filter(env, value) { env.click(`.nav-item[data-filter="${value}"]`); await env.flush(); }
const dialog = env => env.document.querySelector('.lod-root:not([hidden])');
const shadow = env => env.document.querySelector("#lateron-folder-picker")?.shadowRoot;
async function moveTo(env, name) {
  env.click("#bulkProject"); await env.flush();
  const row = [...shadow(env).querySelectorAll(".lon-folder")].find(row => row.querySelector(".lon-folder-name").textContent === name);
  assert.ok(row); row.click(); await env.flush();
  shadow(env).querySelector(".lon-primary").click(); await env.flush();
}

test("全选包含未渲染批次，新窗口按完整顺序打开，窗口失败保留选择可重试", async t => {
  const env = createLibraryPage(t, { items: Array.from({ length: 125 }, (_, n) => makeItem(`n-${n}`, { savedAt: n })) });
  await inbox(env); assert.equal(env.ids().length, 48);
  await pick(env); env.click("#bulkSelectAll"); await env.flush();
  assert.equal(count(env), "已选 125 篇");
  assert.equal(env.document.querySelector("#bulkSelectAll").textContent, "取消全选");
  const create = env.window.chrome.windows.create;
  env.window.chrome.windows.create = async () => { throw Error("Window unavailable"); };
  env.click("#bulkOpenWindow"); await env.flush();
  assert.equal(count(env), "已选 125 篇");
  assert.match(env.document.querySelector("#toast").textContent, /失败/);
  env.window.chrome.windows.create = create;
  env.click("#bulkOpenWindow"); await env.flush();
  assert.equal(env.createdWindows.length, 1);
  assert.deepEqual(env.createdWindows[0].url, Array.from({ length: 125 }, (_, n) => `https://example.test/n-${124 - n}`));
  assert.equal(env.createdWindows[0].focused, true);
  assert.equal(env.document.querySelector("#selectMode").getAttribute("aria-pressed"), "false");
  await env.idleTurn(); assert.equal([...env.document.querySelectorAll(".select-check:checked")].length, 0);
});

test("筛选保留隐藏选择，全选只判断当前结果，批量写入覆盖所有已选而不依赖广播", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a", { status: "done" }), makeItem("b"), makeItem("c", { status: "done" })] });
  await inbox(env); await pick(env, "a", "c"); await filter(env, "unread");
  assert.deepEqual(env.ids(), ["b"]); assert.equal(count(env), "已选 2 篇");
  assert.equal(env.document.querySelector("#bulkSelectAll").textContent, "全选");
  env.click("#bulkSelectAll"); await env.flush(); assert.equal(count(env), "已选 3 篇"); assert.equal(selected(env, "b"), true);
  env.click("#bulkSelectAll"); await env.flush(); assert.equal(count(env), "已选 2 篇"); assert.equal(selected(env, "b"), false);
  env.click("#bulkUnread"); await env.flush();
  assert.deepEqual(mutations(env).at(-1).ids, ["a", "c"]);
  assert.deepEqual(env.store.laterOnItems.map(item => item.status), ["unread", "unread", "unread"]);
  assert.equal(count(env), "已选 0 篇"); assert.deepEqual(env.ids(), ["a", "b", "c"]);
});

test("状态写入失败保留选择，重复提交受阻，重试成功从响应更新卡片", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b")] });
  await inbox(env); await pick(env, "a"); env.failNextWrite();
  env.click("#bulkRead"); await env.flush();
  assert.equal(selected(env, "a"), true); assert.equal(env.store.laterOnItems[0].status, "unread");
  assert.match(env.document.querySelector("#toast").textContent, /失败/);
  env.click("#bulkRead"); env.click("#bulkRead"); await env.flush();
  assert.equal(mutations(env).length, 2);
  assert.equal(env.store.laterOnItems[0].status, "done"); assert.equal(env.store.laterOnItems[1].status, "unread");
  assert.equal(env.card("a").classList.contains("is-read"), true); assert.equal(selected(env, "a"), false);
});

test("多选中的原生项目 change 不写入且恢复显示值，退出后仍能正常移动", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a")], projects: [{ id: "p", name: "Project" }] });
  await inbox(env); await pick(env, "a");
  const select = env.card("a").querySelector(".project-select");
  select.value = "p"; select.dispatchEvent(new env.window.Event("change", { bubbles: true })); await env.flush();
  assert.equal(mutations(env).length, 0); assert.equal(env.store.laterOnItems[0].projectId, null);
  assert.equal(select.value, ""); assert.equal(selected(env, "a"), true); assert.equal(count(env), "已选 1 篇");
  env.click("#bulkDone"); await env.flush();
  select.value = "p"; select.dispatchEvent(new env.window.Event("change", { bubbles: true })); await env.flush();
  assert.equal(mutations(env).length, 1); assert.equal(env.store.laterOnItems[0].projectId, "p");
  assert.deepEqual(env.ids(), []);
});

test("删除取消与写失败可重试；确认期间外部删除只缩减存活目标且不影响新增项", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b"), makeItem("c")], covers: { a: "cover-a", b: "cover-b", c: "cover-c" } });
  await inbox(env); await pick(env, "a", "b");
  env.click("#bulkDelete"); await env.flush(); dialog(env).querySelector(".lod-cancel").click();
  await env.until(() => env.document.querySelector("#bulkBar").getAttribute("aria-busy") === "false", "取消确认完成");
  assert.equal(count(env), "已选 2 篇"); assert.equal(mutations(env).length, 0);
  env.click("#bulkDelete"); await env.flush(); env.failNextWrite(); dialog(env).querySelector(".lod-ok").click();
  await env.until(() => mutations(env).length === 1 && env.document.querySelector("#bulkBar").getAttribute("aria-busy") === "false", "失败完成");
  assert.equal(count(env), "已选 2 篇"); assert.equal(env.store.laterOnItems.length, 3);
  assert.equal(env.store.laterOnCovers.b, "cover-b");
  env.click("#bulkDelete"); await env.flush();
  env.broadcast({ laterOnItems: [makeItem("b", { title: "External edit" }), makeItem("c"), makeItem("new")] }); await env.flush();
  assert.equal(count(env), "已选 1 篇");
  dialog(env).querySelector(".lod-ok").click(); await env.until(() => env.store.laterOnItems.length === 2, "确认删除完成");
  assert.deepEqual(mutations(env).at(-1).ids, ["a", "b"]);
  assert.deepEqual(env.store.laterOnItems.map(item => item.id), ["c", "new"]);
  assert.equal(env.store.laterOnCovers.b, undefined); assert.equal(env.store.laterOnCovers.c, "cover-c");
  assert.match(env.document.querySelector("#toast").textContent, /1/); assert.equal(count(env), "已选 0 篇");
});

test("批量移动使用真实项目浮层，失败停留可重试，响应更新项目计数与范围", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b"), makeItem("c")], projects: [{ id: "p", name: "Project" }] });
  await inbox(env); await pick(env, "a", "b"); env.failNextWrite();
  await moveTo(env, "Project");
  assert.ok(shadow(env)); assert.equal(count(env), "已选 2 篇"); assert.equal(env.store.laterOnItems[0].projectId, null);
  assert.equal(shadow(env).querySelector(".lon-primary").disabled, false);
  shadow(env).querySelector(".lon-primary").click(); await env.flush();
  await env.until(() => !shadow(env), "移动浮层退出动画完成");
  assert.deepEqual(env.ids(), ["c"]); assert.equal(count(env), "已选 0 篇");
  assert.deepEqual(env.store.laterOnItems.map(item => item.projectId), ["p", "p", null]);
  assert.equal(env.document.querySelector('.project-nav[data-project="p"] .nav-count').textContent, "2");
});

test("退出后旧移动浮层和异步窗口回调不会操作或清空新的选择会话", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b")], projects: [{ id: "p", name: "Project" }] });
  await inbox(env); await pick(env, "a");
  env.click("#bulkProject"); await env.flush(); const stale = shadow(env);
  env.click("#bulkDone"); await env.flush(); await pick(env, "b");
  stale.querySelectorAll(".lon-folder")[1].click(); stale.querySelector(".lon-primary").click(); await env.flush();
  assert.equal(mutations(env).length, 0); assert.equal(count(env), "已选 1 篇");
  stale.querySelector(".lon-ghost").click(); await env.flush();
  let complete;
  env.window.chrome.windows.create = () => new Promise(resolve => { complete = resolve; });
  env.click("#bulkOpenWindow"); await env.flush();
  env.click("#bulkDone"); await env.flush(); await pick(env, "a");
  complete({ id: 99 }); await env.flush();
  assert.equal(selected(env, "a"), true); assert.equal(count(env), "已选 1 篇");
  assert.equal(env.document.querySelector("#bulkBar").getAttribute("aria-busy"), "false");
});

test("外部删除清理计数、语言跟随，Escape、空白及返回图板退出并清空", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b")] });
  await inbox(env); await pick(env, "a", "b");
  env.broadcast({ laterOnItems: [makeItem("b")] }); await env.flush(); assert.equal(count(env), "已选 1 篇");
  await env.window.uiTest.i18n.setLanguage("en"); await env.flush(); assert.equal(count(env), "1 selected");
  env.document.querySelector("#bulkDone").focus();
  env.document.activeElement.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await env.flush();
  assert.equal(env.document.activeElement.id, "selectMode"); assert.equal(selected(env, "b"), false);
  await pick(env, "b");
  env.document.body.dispatchEvent(new env.window.MouseEvent("pointerdown", { bubbles: true })); await env.flush();
  assert.equal(env.document.querySelector("#bulkBar").getAttribute("aria-hidden"), "true");
  await pick(env, "b"); env.click('.project-nav[data-project="all"]'); await env.flush();
  assert.equal(env.document.querySelector("#selectMode").getAttribute("aria-pressed"), "false"); assert.equal(count(env), "0 selected");
});

test("写入挂起期间防止重复提交，完成后更新数据但不清空后来开启的选择", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b")] });
  await inbox(env); await pick(env, "a");
  env.document.querySelector("#bulkRead").focus();
  const gate = env.holdNextWrite(); env.click("#bulkRead"); await env.flush(); await gate.started;
  assert.equal(env.document.activeElement.id, "bulkDone");
  assert.equal(env.document.querySelector("#bulkBar").getAttribute("aria-busy"), "true");
  env.click("#bulkRead"); env.click("#bulkDelete"); assert.equal(mutations(env).length, 1);
  env.click("#bulkDone"); await env.flush(); await pick(env, "b");
  gate.release(); await env.until(() => env.document.querySelector("#bulkBar").getAttribute("aria-busy") === "false", "旧写入完成");
  assert.equal(env.card("a").classList.contains("is-read"), true); assert.equal(selected(env, "b"), true);
  env.document.querySelector("#bulkRead").focus();
  env.click("#bulkRead"); await env.flush();
  assert.equal(env.store.laterOnItems[1].status, "done"); assert.equal(count(env), "已选 0 篇");
  assert.equal(env.document.activeElement.id, "selectMode");
});

test("新窗口包含筛选隐藏的已选项并过滤危险网址，无有效网址时保留选择", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a", { status: "done" }), makeItem("b"), makeItem("bad", { url: "javascript:alert(1)" })] });
  await inbox(env); await pick(env, "a", "b", "bad"); await filter(env, "unread");
  env.click("#bulkOpenWindow"); await env.flush();
  assert.deepEqual(env.createdWindows[0].url, ["https://example.test/b", "https://example.test/a"]);
  await pick(env, "bad"); env.click("#bulkOpenWindow"); await env.flush();
  assert.equal(env.createdWindows.length, 1); assert.equal(count(env), "已选 1 篇");
  assert.match(env.document.querySelector("#toast").textContent, /没有可打开/);
});

test("同一会话写入时新增选择不会被旧批次清空", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a"), makeItem("b")] });
  await inbox(env); await pick(env, "a");
  const gate = env.holdNextWrite(); env.click("#bulkRead"); await env.flush(); await gate.started;
  env.card("b").querySelector(".title-link").click(); await env.flush(); assert.equal(count(env), "已选 2 篇");
  gate.release(); await env.until(() => env.document.querySelector("#bulkBar").getAttribute("aria-busy") === "false", "写入完成");
  assert.equal(env.store.laterOnItems[0].status, "done"); assert.equal(env.store.laterOnItems[1].status, "unread");
  assert.equal(selected(env, "a"), false); assert.equal(selected(env, "b"), true); assert.equal(count(env), "已选 1 篇");
  env.click("#bulkRead"); await env.flush(); assert.equal(env.store.laterOnItems[1].status, "done");
});

test("外部切到图板恢复可见焦点，卸载会关闭移动浮层并禁止旧回调", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a")], projects: [{ id: "p", name: "Project" }] });
  await inbox(env); await pick(env, "a"); env.document.querySelector("#bulkDone").focus();
  env.broadcast({ laterOnActiveProject: "all" }); await env.flush();
  assert.equal(env.document.activeElement.id, "homeBrand");
  await inbox(env); await pick(env, "a"); env.click("#bulkProject"); await env.flush(); const stale = shadow(env);
  env.document.querySelector("#app").__vue_app__.unmount();
  stale.querySelectorAll(".lon-folder")[1].click(); stale.querySelector(".lon-primary").click(); await env.flush();
  assert.equal(mutations(env).length, 0);
  await env.until(() => !shadow(env), "卸载后浮层清理完成");
});
