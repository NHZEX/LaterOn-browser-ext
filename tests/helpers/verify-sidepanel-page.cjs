const assert = require("node:assert/strict");
const { createPanelPage, makeItem, makeStore } = require("./panel-page.cjs");

module.exports = async function verifySidepanelPage(t, { language = "zh-CN", directory } = {}) {
  const store = { ...makeStore([
    makeItem({ id: "a", projectId: "p", title: "Alpha", savedAt: 3 }),
    makeItem({ id: "b", projectId: "q", title: "Beta", status: "reading", savedAt: 2 }),
    makeItem({ id: "c", projectId: "q", title: "Beta done", status: "done", savedAt: 1 }),
    makeItem({ id: "u", projectId: null }), makeItem({ id: "hidden", projectId: "archived", title: "Beta archived" })
  ]), laterOnProjects: [{ id: "p", name: "Project P" }, { id: "q", name: "Project Q" }, { id: "archived", name: "Archived", archived: true }],
    laterOnActiveProject: "p", laterOnSettings: { language, autoMarkRead: false } };
  const env = createPanelPage(t, { store, directory }); // Own writes do not broadcast.
  const { document, window } = env;
  const ids = () => [...document.querySelectorAll("#items .item")].map(card => card.dataset.id).sort().join(",");
  const click = selector => env.click(document.querySelector(selector));
  const search = value => {
    const input = document.querySelector("#searchInput"); input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  await env.until(() => ids() === "a", "恢复项目与未读范围");
  assert.equal(document.documentElement.lang, language);
  assert.equal(document.querySelector("#searchInput").placeholder, language === "en" ? "Search pages" : "搜索网页");
  assert.equal(document.querySelectorAll(".project-filter").length, 3, "没有全库或归档项目入口");
  assert.equal(document.querySelector('[data-project="q"] strong').textContent, "2", "项目计数包含已读收藏");
  search("  BETA  ");
  await env.until(() => ids() === "b", "跨项目搜索保留未读筛选并排除归档项目");
  click('.filter[data-filter="done"]');
  await env.until(() => ids() === "c", "无需广播即刻切换阅读筛选");
  assert.equal(env.store.laterOnFilterChosen, true);
  assert.equal(env.store.laterOnFilter, "done");
  assert.equal(document.querySelector('.filter[data-filter="done"]').getAttribute("aria-pressed"), "true");
  search("");
  await env.until(() => ids() === "", "清空搜索回到原项目");
  click('[data-project="q"]');
  await env.until(() => ids() === "c", "无广播更新项目和卡片");
  assert.equal(env.store.laterOnActiveProject, "q");
  assert.equal(document.querySelector('[data-project="q"]').getAttribute("aria-pressed"), "true");
  env.broadcast({ laterOnFilter: "unread", laterOnActiveProject: "p" });
  await env.until(() => ids() === "a", "全屏项目与筛选广播同步");
  env.broadcast({ laterOnProjects: [{ id: "q", name: "Project Q" }] });
  await env.until(() => ids() === "u" && document.querySelector('[data-project="unfiled"]').getAttribute("aria-pressed") === "true", "失效项目回到等待整理");
  env.broadcast({ laterOnActiveProject: "all" });
  await env.flush();
  assert.equal(ids(), "u", "全屏 all 范围不能在侧栏留下无选中目录");
  assert.equal(document.querySelector("#itemCount").textContent, window.uiTest.i18n.t("cardCount", { n: 1 }));
  const card = env.item("u");
  const button = card.querySelector(".read-toggle");
  button.focus();
  env.broadcast({ laterOnItems: [makeItem({ id: "u", title: "Updated card", source: "updated.test", image: "https://i.ytimg.com/vi/build/maxresdefault.jpg",
    favicon: "https://updated.test/favicon.png", savedAt: window.Date.now() - 2 * 86400000 })], laterOnCurrentItem: "u" });
  await env.flush();
  assert.equal(env.item("u"), card, "构建产物复用卡片节点");
  assert.equal(document.activeElement, button);
  assert.equal(card.querySelector("h2").textContent, "Updated card");
  assert.equal(card.querySelector(".source").textContent, "updated.test");
  assert.equal(card.querySelector("time").textContent, window.uiTest.i18n.t("daysAgo", { n: 2 }));
  assert.equal(card.classList.contains("is-current"), true);
  assert.equal(env.store.laterOnCurrentItem, "u", "同批阅读标记不被当前标签回写覆盖");
  assert.equal(card.querySelector(".thumb-img").getAttribute("referrerpolicy"), "no-referrer");
  for (const file of ["hq720", "hqdefault", "mqdefault"]) {
    card.querySelector(".thumb-img").dispatchEvent(new window.Event("error")); await env.flush();
    assert.equal(card.querySelector(".thumb-img").src, `https://i.ytimg.com/vi/build/${file}.jpg`);
  }
  card.querySelector(".thumb-img").dispatchEvent(new window.Event("error")); await env.flush();
  assert.equal(card.querySelector(".thumb-img"), null);
  assert.ok(card.querySelector(".thumb-logo"));
  env.click(button);
  await env.until(() => env.count() === 0, "产物卡片操作不依赖自身广播");
  assert.equal(env.store.laterOnItems[0].status, "done");
  // 对生产和自定义模式的真实页面验证顺序，存储数组刻意不按时间排列。
  env.broadcast({ laterOnItems: [makeItem({ id: "old", savedAt: 1, source: "m.test" }),
    makeItem({ id: "new", savedAt: 3, source: "z.test" }), makeItem({ id: "middle", savedAt: 2, source: "a.test" })],
    laterOnOrder: { unfiled: ["old", "middle"] } });
  const orderedIds = () => [...document.querySelectorAll("#items .item")].map(element => element.dataset.id);
  for (const [sort, order] of Object.entries({ newest: ["new", "middle", "old"], oldest: ["old", "middle", "new"], source: ["middle", "old", "new"], custom: ["old", "middle", "new"] })) {
    env.broadcast({ laterOnSettings: { language, defaultSort: sort } }); await env.flush();
    assert.deepEqual(orderedIds(), order, `构建产物恢复 ${sort} 排序`);
  }
  // 两种构建模式执行 Vue 菜单与编辑命令；自身写入不发送 storage 广播。
  const link = env.item("old").querySelector(".open-item"); link.focus();
  link.dispatchEvent(new window.KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
  await env.until(() => document.querySelector('[role="menuitem"]'), "构建产物键盘菜单"); await env.flush();
  assert.equal(document.activeElement, document.querySelector('[data-action="open"]'));
  env.click(document.querySelector('[data-action="edit"]'));
  const dialog = () => document.querySelector(".lod-root:not([hidden])");
  await env.until(() => dialog(), "构建产物编辑入口"); await env.frame();
  const input = dialog().querySelector('[data-field="title"]'); assert.equal(document.activeElement, input);
  input.value = "Edited in built page"; env.failNextWrite(); env.click(dialog().querySelector(".lod-ok")); await env.clock.tickAsync(280);
  assert.equal(env.item("old").querySelector("h2").textContent, "存储里的新标题");
  env.click(env.item("old").querySelector(".edit")); await env.until(() => dialog(), "失败后重新编辑");
  dialog().querySelector('[data-field="title"]').value = "Edited in built page";
  env.click(dialog().querySelector(".lod-ok")); await env.clock.tickAsync(280);
  assert.equal(env.item("old").querySelector("h2").textContent, "Edited in built page");
  assert.equal(env.store.laterOnItems.find(item => item.id === "old").titleEdited, true);
  // 两种模式也执行当前网页的 Vue 入口；仅控制标签查询和扩展消息边界。
  const requests = [];
  window.chrome.tabs.query = async () => [{ id: 42, windowId: 7, active: true, title: "Tab fallback", url: "https://build.test/current" }];
  window.chrome.runtime.sendMessage = async message => {
    requests.push(structuredClone(message));
    return message.type === "EXTRACT_METADATA" ? { ok: true, metadata: { title: "Built metadata", source: "build.test" } } : { ok: true, pending: true };
  };
  env.activated.forEach(listener => listener({ tabId: 42, windowId: 7 }));
  await env.until(() => document.querySelector("#currentTitle").textContent === "Built metadata", "构建产物补齐当前页资料");
  const save = document.querySelector("#saveCurrent");
  assert.equal(save.disabled, false); env.click(save); await env.flush();
  assert.equal(document.querySelector("#status").textContent, window.uiTest.i18n.t("pickerOpened"));
  assert.equal(save.disabled, false); assert.equal(save.classList.contains("saved"), false);
  assert.deepEqual(requests.find(message => message.type === "QUICK_SAVE_TAB"), { type: "QUICK_SAVE_TAB", source: "panel", tabId: 42 });
};
