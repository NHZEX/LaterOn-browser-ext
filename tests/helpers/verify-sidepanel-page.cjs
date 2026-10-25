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
  assert.equal(document.querySelector("#itemCount").textContent, window.LaterOnI18n.t("cardCount", { n: 1 }));
};
