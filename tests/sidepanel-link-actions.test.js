const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage, makeStore } = require("./helpers/panel-page.cjs");

test("真实侧栏链接保留修饰键、右键菜单和普通新标签行为", async t => {
  const opened = [];
  const env = createPanelPage(t, { store: { ...makeStore(), laterOnSettings: { autoMarkRead: false } }, setup(window) {
    window.chrome.tabs.create = async options => { opened.push(structuredClone(options)); return { id: 9 }; };
  } });
  await env.until(() => env.item("fresh"), "侧栏卡片");
  const link = env.item("fresh").querySelector(".open-item");
  assert.equal(link.tagName, "A"); assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noreferrer"); assert.equal(link.href, "https://x.com/");
  const prevented = [];
  const browserNavigation = event => { prevented.push(event.defaultPrevented); event.preventDefault(); };
  // JSDOM has no tab navigation; intercept only after the real page handler has run.
  env.document.addEventListener("click", browserNavigation);
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    link.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true }));
  }
  await env.flush();
  assert.deepEqual(prevented, [false, false, false, false], "保留浏览器原生修饰键动作");
  assert.deepEqual(opened, []);
  env.document.removeEventListener("click", browserNavigation);
  env.click(link);
  await env.until(() => opened.length === 1, "普通点击创建前台标签");
  assert.deepEqual(opened[0], { url: "https://x.com", active: true });
  const event = new env.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
  link.querySelector("h2").dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual([...env.document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent), ["在新标签页打开", "编辑标题与摘要", "删除"]);
  env.click(env.document.querySelector('[role="menuitem"]'));
  await env.until(() => opened.length === 2, "右键菜单后台新建标签");
  assert.deepEqual(opened[1], { url: "https://x.com", active: false });
  assert.equal(env.document.querySelector('[role="menu"]'), null);
});
