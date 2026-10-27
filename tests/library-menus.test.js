const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createLibraryPage, makeItem } = require("./helpers/library-card-page.cjs");
const { libraryMenuContent, menuPosition } = require("./helpers/load-module.cjs")("src/library/menu.ts");
const menu = env => env.document.querySelector("[role='menu']");
const entries = env => [...menu(env).querySelectorAll("[role='menuitem']")];
const press = async (env, element, key, extra = {}) => {
  element.dispatchEvent(new env.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  await env.flush();
};
const rightClick = async (env, element) => {
  element.dispatchEvent(new env.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
  await env.flush();
};
const openProject = async (env, id = "p") => {
  await env.until(() => env.document.querySelector(`.project-row[data-id="${id}"] .project-more`), "项目菜单入口");
  const trigger = env.document.querySelector(`.project-row[data-id="${id}"] .project-more`);
  trigger.click(); await env.flush();
  assert.ok(menu(env)); return trigger;
};
const pick = async (env, action) => { env.click(`[role='menuitem'][data-action="${action}"]`); await env.flush(); };

test("菜单模型从不可变集合派生最新状态，缺失目标不产生操作，坐标限制在视口内", () => {
  const collection = Object.freeze({ items: Object.freeze([Object.freeze(makeItem("a"))]),
    projects: Object.freeze([Object.freeze({ id: "p", name: "Project", pinned: true, archived: true })]), covers: Object.freeze({}) });
  const project = libraryMenuContent(collection, { kind: "project", id: "p" }, new Set(), false, key => key);
  assert.equal(project.entries[0].label, "unpinProject");
  assert.equal(project.entries[3].label, "restoreProject");
  assert.equal(libraryMenuContent(collection, { kind: "item", id: "a" }, new Set(["a"]), true, key => key).entries[2].label, "itemDeselect");
  assert.equal(libraryMenuContent(collection, { kind: "item", id: "missing" }, new Set(), false, key => key), null);
  assert.deepEqual(menuPosition(-10, -10, 180, 200, 375, 700), { left: 8, top: 8 });
  assert.deepEqual(menuPosition(1000, 1000, 180, 200, 375, 700), { left: 187, top: 492 });
});

test("项目菜单打开聚焦首项，方向键循环、Home/End 与 Escape 恢复触发按钮", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project" }] });
  const trigger = await openProject(env);
  assert.equal(env.document.activeElement, entries(env)[0]);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  for (const [key, index] of [["ArrowUp", 4], ["ArrowDown", 0], ["End", 4], ["Home", 0], ["ArrowDown", 1]]) {
    await press(env, env.document.activeElement, key);
    assert.equal(env.document.activeElement, entries(env)[index]);
  }
  await press(env, env.document.activeElement, "Escape");
  assert.equal(menu(env), null);
  assert.equal(env.document.activeElement, trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await press(env, trigger, "F10", { shiftKey: true });
  assert.ok(menu(env));
  await pick(env, "rename");
  assert.equal(env.document.activeElement, env.document.querySelector(".project-rename"));
  await press(env, env.document.activeElement, "Escape");
  assert.equal(env.document.querySelector(".project-rename"), null);
});

test("卡片键盘与右键入口共享菜单，多选期间菜单点击保留会话并使用最新收藏", async t => {
  const env = createLibraryPage(t, { items: [makeItem("a")] });
  await env.until(() => env.document.querySelector('.project-nav[data-project="unfiled"]'), "导航");
  env.click('.project-nav[data-project="unfiled"]'); await env.flush();
  const link = env.card("a").querySelector(".title-link"); link.focus();
  await press(env, link, "ContextMenu");
  assert.equal(env.document.activeElement, entries(env)[0]);
  await pick(env, "select");
  assert.equal(env.card("a").classList.contains("selected"), true);
  await rightClick(env, env.card("a"));
  const action = menu(env).querySelector('[data-action="select"]');
  action.dispatchEvent(new env.window.MouseEvent("pointerdown", { bubbles: true }));
  await env.flush();
  assert.equal(env.card("a").classList.contains("selected"), true, "菜单 pointerdown 不提前退出多选");
  action.click(); await env.flush();
  assert.equal(env.card("a").classList.contains("selected"), false);
  assert.equal(env.document.querySelector("#selectMode").classList.contains("active"), true);
  await rightClick(env, env.card("a"));
  await press(env, env.document.activeElement, "Escape");
  assert.equal(env.document.querySelector("#selectMode").classList.contains("active"), true, "Escape 只关闭菜单");
  await rightClick(env, env.card("a"));
  env.broadcast({ laterOnItems: [makeItem("a", { title: "External title", url: "https://example.test/latest" })] }); await env.flush();
  assert.equal(menu(env).querySelector(".folder-menu-title").textContent, "External title");
  await pick(env, "open");
  assert.equal(env.opened[0].url, "https://example.test/latest");
  assert.equal(env.opened[0].active, false);
  assert.equal(env.opened[0].openerTabId, 1);
});

test("外部改名、置顶和语言实时更新菜单，删除目标后关闭且恢复到可用焦点", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project" }] });
  await openProject(env);
  await press(env, env.document.activeElement, "ArrowDown");
  const focused = env.document.activeElement;
  env.broadcast({ laterOnProjects: [{ id: "p", name: "Renamed", pinned: true, archived: true }] }); await env.flush();
  assert.equal(menu(env).querySelector(".folder-menu-title").textContent, "Renamed");
  assert.equal(menu(env).querySelector('[data-action="pin"]').textContent, "取消置顶");
  assert.equal(menu(env).querySelector('[data-action="archive"]').textContent, "恢复项目");
  assert.equal(env.document.activeElement, focused);
  await env.window.uiTest.i18n.setLanguage("en"); await env.flush();
  assert.equal(menu(env).querySelector('[data-action="archive"]').textContent, env.window.uiTest.i18n.t("restoreProject"));
  env.broadcast({ laterOnProjects: [] }); await env.flush();
  assert.equal(menu(env), null);
  assert.equal(env.document.activeElement, env.document.querySelector("#searchInput"));
  assert.equal(env.commands.length, 0);
});

test("菜单写入失败可重新打开重试，成功更新不依赖自身存储广播", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "Project" }] });
  await openProject(env);
  env.failNextWrite("laterOnProjects"); await pick(env, "pin");
  await env.until(() => env.document.querySelector("#toast").textContent.includes("失败"), "失败提示");
  assert.equal(!!env.store.laterOnProjects[0].pinned, false);
  await openProject(env); await pick(env, "pin");
  await env.until(() => env.store.laterOnProjects[0].pinned && env.document.querySelector('.project-row.is-pinned'), "重试置顶");
  await openProject(env);
  assert.equal(menu(env).querySelector('[data-action="pin"]').textContent, "取消置顶");
  assert.equal(env.commands.filter(command => command.action === "setProjectPinned").length, 2);
});

test("替换菜单和关闭取消旧动画帧，外部点击、滚动、失焦、resize 与 Tab 均可退出", async t => {
  const env = createLibraryPage(t, { projects: [{ id: "p", name: "First" }, { id: "q", name: "Second" }] });
  await openProject(env, "p");
  const stale = env.pendingFrames();
  await openProject(env, "q");
  stale.forEach(callback => callback()); await env.flush();
  assert.equal(menu(env).querySelector(".folder-menu-title").textContent, "Second");
  assert.equal(menu(env).classList.contains("is-open"), false);
  await env.frame();
  assert.equal(menu(env).classList.contains("is-open"), true);
  const search = env.document.querySelector("#searchInput");
  search.dispatchEvent(new env.window.MouseEvent("pointerdown", { bubbles: true })); search.focus(); await env.flush();
  assert.equal(menu(env), null); assert.equal(env.document.activeElement, search);
  for (const [target, type] of [[env.document, "scroll"], [env.window, "resize"], [env.window, "blur"]]) {
    await openProject(env); target.dispatchEvent(new env.window.Event(type)); await env.flush(); assert.equal(menu(env), null);
  }
  await openProject(env);
  await press(env, env.document.activeElement, "Tab");
  assert.equal(menu(env), null);
});
