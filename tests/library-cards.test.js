const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLibraryPage: page, makeItem } = require("./helpers/library-card-page.cjs");
const rules = require("./helpers/load-module.cjs")("src/library/shared.ts");
const enterInbox = async env => {
  await env.until(() => env.document.querySelector('.project-nav[data-project="unfiled"]'), "导航就绪");
  env.click('.project-nav[data-project="unfiled"]');
  await env.flush();
};

test("列表投影保持归档、全局搜索和各范围自定义顺序，输入不可变", () => {
  const items = Object.freeze([
    Object.freeze(makeItem("a", { savedAt: 1, projectId: "p", status: "done", source: "B" })),
    Object.freeze(makeItem("b", { savedAt: 2, projectId: "p", status: "reading", source: "A" })),
    Object.freeze(makeItem("c", { savedAt: 3 })),
    Object.freeze(makeItem("x", { savedAt: 4, projectId: "archived" }))
  ]);
  const collection = Object.freeze({ items, projects: Object.freeze([Object.freeze({ id: "p" }), Object.freeze({ id: "archived", archived: true })]), covers: Object.freeze({}) });
  const scope = { activeProject: "p", query: "", filter: "all", sort: "custom" };
  const orders = Object.freeze({ p: Object.freeze(["missing", "a", "b"]), unfiled: Object.freeze(["c"]) });
  const ids = (changes = {}) => rules.collectionCards(collection, { ...scope, ...changes }, orders).visible.map(item => item.id);
  assert.deepEqual(ids(), ["a", "b"]);
  assert.deepEqual(ids({ filter: "unread" }), ["b"]);
  assert.deepEqual(ids({ query: "example.test/c" }), ["c"], "搜索越过当前项目，但排除归档");
  assert.deepEqual(ids({ activeProject: "archive", query: "example.test" }), ["x"]);
  assert.deepEqual(ids({ activeProject: "archived" }), ["x"]);
  assert.deepEqual(ids({ activeProject: "all", sort: "oldest" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ sort: "source" }), ["b", "a"]);
  assert.deepEqual(rules.collectionCards(collection, scope, { p: {} }).visible.map(item => item.id), ["b", "a"], "旧存储的异常顺序降级到最新收藏");
  for (const target of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "invalid"]) assert.equal(rules.cardTarget(target), "");
  assert.equal(rules.cardTarget(" https://example.test/a "), "https://example.test/a");
});

test("千条收藏分批显示；切换阅读筛选和项目后过期空闲任务不能回流", async t => {
  const items = Array.from({ length: 1000 }, (_, index) => makeItem(`n-${index}`, { savedAt: 1000 - index, status: index % 2 ? "done" : "unread" }));
  const env = page(t, { items, projects: [{ id: "p", name: "Project" }] });
  await enterInbox(env);
  assert.equal(env.ids().length, 48);
  assert.match(env.document.querySelector("#countText").textContent, /1000/);
  await env.idleTurn();
  assert.equal(env.ids().length, 96);
  const stale = env.pendingIdle();
  assert.ok(stale.length > 0);
  env.click('.nav-item[data-filter="done"]'); await env.flush();
  stale.forEach(callback => callback()); await env.flush();
  assert.ok(env.ids().every(id => Number(id.slice(2)) % 2 === 1));
  await env.until(() => env.ids().length === 500, "筛选后全部已读卡片", { runIdle: true });
  env.click('.nav-item[data-filter="unread"]'); await env.flush();
  const prior = env.pendingIdle();
  assert.ok(prior.length > 0);
  env.click('.project-nav[data-project="p"]'); await env.flush();
  prior.forEach(callback => callback()); await env.flush();
  assert.deepEqual(env.ids(), []);
  assert.equal(env.document.querySelector("#emptyState").hidden, false);
  env.click('.project-nav[data-project="all"]'); await env.idleTurn();
  assert.deepEqual(env.ids(), [], "回图板后不留下卡片");
});

test("侧栏目标在后续批次出现后才定位，筛选隐藏目标时不跳档", async t => {
  const items = Array.from({ length: 160 }, (_, index) => makeItem(`n-${index}`, { savedAt: 160 - index }));
  const env = page(t, { items, current: "n-120", params: "?from=sidepanel&project=unfiled&filter=all&focus=n-120" });
  await env.until(() => env.ids().length === 48, "首批");
  assert.deepEqual(env.scrolled, []);
  await env.until(() => env.scrolled.includes("n-120"), "目标批次后定位", { runIdle: true });
  assert.equal(env.card("n-120").classList.contains("is-current"), true);
  assert.equal(env.document.querySelectorAll(".card.is-current").length, 1);
  env.broadcast({ laterOnCurrentItem: "n-2" });
  await env.until(() => env.scrolled.includes("n-2"), "外部当前阅读同步");
  assert.equal(env.card("n-2").classList.contains("is-current"), true);
  assert.equal(env.card("n-120").classList.contains("is-current"), false);
  const hidden = page(t, { items, current: "n-120", params: "?from=sidepanel&project=unfiled&filter=done&focus=n-120" });
  await hidden.until(() => hidden.document.querySelector('.project-nav.active[data-project="unfiled"]'), "筛选入口");
  await hidden.frame();
  assert.deepEqual(hidden.ids(), []);
  assert.deepEqual(hidden.scrolled, []);
  assert.equal(hidden.document.querySelector('.nav-item[data-filter="done"]').getAttribute("aria-pressed"), "true");
});

test("无自身广播时状态和选择立即跟随；外部更新复用卡片、焦点与当前阅读标识", async t => {
  const env = page(t, { items: [makeItem("a"), makeItem("b")], projects: [{ id: "p", name: "Original" }] });
  await enterInbox(env);
  const card = env.card("a");
  env.failNextWrite();
  env.click('[data-id="a"] .read-toggle');
  await env.until(() => env.document.querySelector("#toast").textContent.includes("失败"), "状态写入失败提示");
  assert.equal(env.store.laterOnItems[0].status, "unread");
  assert.equal(card.classList.contains("is-read"), false);
  env.click('[data-id="a"] .read-toggle');
  await env.until(() => env.store.laterOnItems[0].status === "done" && card.classList.contains("is-read"), "无广播状态更新");
  const select = card.querySelector(".project-select"); select.focus();
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => item.id === "a" ? { ...item, title: "New title", source: "New source", favicon: "https://example.test/icon.png", url: "javascript:alert(1)" } : item),
    laterOnProjects: [{ id: "p", name: "Renamed" }] });
  await env.until(() => card.querySelector("h2").textContent === "New title", "卡片内容更新");
  assert.equal(env.card("a"), card);
  assert.equal(env.document.activeElement, select);
  assert.equal(card.querySelector(".source-name").textContent, "New source");
  assert.equal(card.querySelector(".title-link").getAttribute("href"), "#");
  assert.equal(card.querySelector(".cover-link").getAttribute("href"), "#");
  assert.equal(select.querySelector('option[value="p"]').textContent, "Renamed");
  env.click("#selectMode"); env.click('[data-id="a"] .title-link'); await env.flush();
  assert.equal(card.classList.contains("selected"), true);
  assert.equal(card.querySelector(".select-check").checked, true);
  assert.deepEqual(env.opened, []);
  env.broadcast({ laterOnCurrentItem: "a" }); await env.flush();
  assert.equal(card.classList.contains("selected"), true);
  assert.equal(card.classList.contains("is-current"), true);
  env.click("#bulkDone"); await env.flush();
  assert.equal(card.classList.contains("selected"), false);
  assert.equal(card.querySelector(".select-check").checked, false);
});

test("卡片项目入口在写入失败后可重试，新建项目与移动不依赖自身广播", async t => {
  const env = page(t, { items: [makeItem("a")], projects: [{ id: "p", name: "Original" }] });
  await enterInbox(env);
  const picker = () => env.document.querySelector("#lateron-folder-picker")?.shadowRoot;
  const open = async () => {
    env.click('[data-id="a"] .project-select');
    await env.flush();
    assert.ok(picker());
  };
  const choose = () => {
    [...picker().querySelectorAll(".lon-folder")].find(button => button.querySelector(".lon-folder-name").textContent === "Original").click();
    picker().querySelector(".lon-primary").click();
  };
  await open();
  env.failNextWrite(); choose();
  await env.until(() => env.document.querySelector("#toast").textContent.includes("失败"), "移动失败");
  assert.equal(env.store.laterOnItems[0].projectId, null);
  assert.ok(env.card("a"));
  await env.clock.tickAsync(300);
  await open(); choose();
  await env.until(() => env.store.laterOnItems[0].projectId === "p" && !env.card("a"), "重试后移出待整理");
  env.click('.project-nav[data-project="p"]'); await env.flush();
  assert.equal(env.card("a").querySelector(".project-select").value, "p");
  await env.clock.tickAsync(300);
  await open();
  const input = picker().querySelector(".lon-new-input");
  input.value = "Created from card";
  input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  picker().querySelector(".lon-primary").click();
  await env.until(() => env.store.laterOnProjects.some(project => project.name === "Created from card") && !env.card("a"), "创建并移动");
  const project = env.store.laterOnProjects.find(project => project.name === "Created from card");
  env.click(`.project-nav[data-project="${project.id}"]`); await env.flush();
  assert.equal(env.store.laterOnItems[0].projectId, project.id);
  assert.equal(env.card("a").querySelector(".project-select").value, project.id);
  assert.equal(env.card("a").querySelector(`option[value="${project.id}"]`).textContent, project.name);
});

test("封面失败回退不因无关更新重载，后续新封面可恢复，语言和图标更新跟随", async t => {
  const env = page(t, { items: [makeItem("a", { image: "https://i.ytimg.com/vi/id/maxresdefault.jpg", favicon: "https://example.test/old.png" })] });
  await enterInbox(env);
  const card = env.card("a");
  const image = () => card.querySelector(".cover-img");
  assert.equal(image().getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(card.querySelector(".favicon").getAttribute("referrerpolicy"), "no-referrer");
  for (const file of ["hq720.jpg", "hqdefault.jpg", "mqdefault.jpg"]) {
    image().dispatchEvent(new env.window.Event("error")); await env.flush();
    assert.equal(new URL(image().src).pathname.split("/").at(-1), file);
  }
  image().dispatchEvent(new env.window.Event("error")); await env.flush();
  assert.equal(image(), null);
  assert.ok(card.querySelector(".cover-placeholder"));
  const favicon = card.querySelector(".favicon"); favicon.dispatchEvent(new env.window.Event("error")); await env.flush();
  assert.equal(favicon.style.visibility, "hidden");
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => ({ ...item, title: "Updated", favicon: "https://example.test/new.png" })) }); await env.flush();
  assert.equal(image(), null, "无关文字变化不会重新尝试坏封面");
  assert.equal(favicon.style.visibility, "");
  env.broadcast({ laterOnItems: env.store.laterOnItems.map(item => ({ ...item, image: "local://a" })), laterOnCovers: { a: "data:image/png;base64,AAAA" } }); await env.flush();
  assert.equal(image().getAttribute("src"), env.store.laterOnCovers.a);
  await env.window.uiTest.i18n.setLanguage("en"); await env.flush();
  assert.equal(card.querySelector(".edit").getAttribute("aria-label"), env.window.uiTest.i18n.t("editItemAria"));
});

test("外部集合更新取消卡片拖拽并清理临时节点，迟到 drop 不写过期顺序", async t => {
  const env = page(t, { items: [makeItem("a"), makeItem("b")] });
  await enterInbox(env);
  const event = type => {
    const event = new env.window.Event(type, { bubbles: true, cancelable: true });
    event.dataTransfer = { setData() {}, setDragImage() {} }; return event;
  };
  env.card("a").dispatchEvent(event("dragstart"));
  assert.ok(env.document.querySelector(".drag-home-frame"));
  env.broadcast({ laterOnItems: [...env.store.laterOnItems, makeItem("c")] });
  await env.frame(); await env.flush();
  assert.equal(env.document.querySelector(".drag-home-frame, .drag-preview, .dragging"), null);
  assert.ok(env.card("c"));
  env.document.querySelector("#cardGrid").dispatchEvent(event("drop")); await env.flush();
  assert.equal(env.commands.filter(command => command.action === "moveItem").length, 0);
});
