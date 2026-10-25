const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage, makeItem, makeStore } = require("./helpers/panel-page.cjs");

test("删除确认脚本加载失败时保留卡片、收藏和封面", async t => {
  const env = createPanelPage(t, { store: {
    ...makeStore([makeItem({ image: "local://fresh" })]), laterOnCovers: { fresh: "cover" }
  } });
  await env.until(() => env.item("fresh"), "待删除卡片");
  env.window.LaterOnDialog = undefined;
  env.click(env.item("fresh").querySelector(".delete"));
  const script = env.document.querySelector('script[src="dialog.js"]');
  assert.ok(script, "真实删除入口按需加载确认组件");
  script.dispatchEvent(new env.window.Event("error"));
  await env.until(() => env.document.querySelector("#status").textContent.includes("失败"), "加载失败反馈");
  assert.ok(env.item("fresh"));
  assert.equal(env.store.laterOnItems.length, 1);
  assert.equal(env.store.laterOnCovers.fresh, "cover");
  assert.equal(env.document.querySelector(".lod-root:not([hidden])"), null);
});
