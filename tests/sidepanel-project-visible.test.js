const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage, makeStore } = require("./helpers/panel-page.cjs");

test("真实侧栏项目切换只滚动横向目录，保持页面阅读位置", async t => {
  const env = createPanelPage(t, { store: { ...makeStore(), laterOnProjects: [{ id: "right", name: "Right" }, { id: "left", name: "Left" }] } });
  await env.until(() => env.item("fresh"), "侧栏首屏");
  const container = env.document.querySelector("#projectFilters");
  let left = 600, scrolls = 0;
  env.window.scrollTo = () => scrolls++;
  Object.defineProperties(container, { clientWidth: { value: 320, configurable: true }, scrollWidth: { value: 1200 } });
  container.getBoundingClientRect = () => ({ left: 100 });
  for (const button of container.children) button.getBoundingClientRect = () => ({ left: 100 + left - container.scrollLeft, right: 200 + left - container.scrollLeft });
  env.click(container.querySelector('[data-project="right"]'));
  await env.frame();
  assert.equal(container.scrollLeft, 388);
  env.click(container.querySelector('[data-project="right"]')); await env.frame();
  assert.equal(container.scrollLeft, 388, "已可见时不重复滚动");
  left = 50;
  env.click(container.querySelector('[data-project="left"]')); await env.frame();
  assert.equal(container.scrollLeft, 42);
  left = 0;
  env.click(container.querySelector('[data-project="unfiled"]')); await env.frame();
  assert.equal(container.scrollLeft, 0, "等待整理回到左端且不越界");
  Object.defineProperty(container, "clientWidth", { value: 0 });
  env.click(container.querySelector('[data-project="right"]')); await env.frame();
  assert.equal(container.scrollLeft, 0, "尚未布局时不滚动");
  assert.equal(scrolls, 0, "不改变页面纵向滚动");
});
