const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage } = require("./helpers/panel-page.cjs");
const verify = require("./helpers/verify-sidepanel-page.cjs");

for (const language of ["zh-CN", "en"]) test(`原生 Vue 侧栏控件与跨页面同步：${language}`, t => verify(t, { language }));

test("握手在数据读取前注册，等待窗口 ID，卸载取消待执行任务与监听", async t => {
  let resolveWindow;
  const env = createPanelPage(t, { pendingGet: true, setup(window) {
    window.chrome.windows.getCurrent = () => new Promise(resolve => { resolveWindow = resolve; });
  } });
  assert.equal(env.messages.size, 1, "不等首帧与存储读取就接受握手");
  const ping = async id => {
    let response;
    const listener = [...env.messages][0];
    assert.equal(listener({ type: "PING_SIDEPANEL", windowId: id }, {}, value => { response = value; }), true);
    await env.flush();
    return response;
  };
  assert.equal(await ping(7), undefined, "窗口尚未返回时等待");
  resolveWindow({ id: 7 });
  await env.flush();
  assert.equal((await ping(7)).ready, false);
  await env.frame(); await env.frame();
  env.releaseGet();
  await env.until(() => env.store.laterOnPanelDiag, "数据就绪");
  assert.equal((await ping(7)).ready, true);
  assert.equal((await ping(8)).ready, false, "只接受同窗口握手");
  const input = env.document.querySelector("#searchInput"); input.value = "pending search";
  input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  const card = env.item("fresh");
  const drag = new env.window.MouseEvent("dragstart", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  drag.dataTransfer = { setData() {}, setDragImage() {} };
  card.dispatchEvent(drag);
  assert.ok(env.document.querySelector(".card-drag-preview"));
  const baselineListeners = env.listeners.size;
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  assert.equal(env.messages.size, 0);
  assert.equal(env.activated.size, 0); assert.equal(env.updated.size, 0);
  assert.equal(env.listeners.size, baselineListeners - 1, "卸载移除侧栏存储订阅");
  const count = env.count(), writes = env.cacheWrites.length;
  env.broadcast({ laterOnItems: [] });
  await env.clock.tickAsync(1000); await env.frame(); await env.idleTurn();
  assert.equal(env.count(), count, "卸载后不运行搜索和广播渲染");
  assert.equal(env.cacheWrites.length, writes, "取消尚未执行的快照写入");
  assert.equal(env.document.querySelector(".card-drag-preview"), null);
  assert.equal(card.classList.contains("dragging"), false, "取消尚未执行的拖拽帧");
  assert.equal(env.document.querySelector("#searchInput"), null, "Vue Teleport 卸载");
});

test("缓存已显示但存储尚未返回时卸载，迟到读取不能恢复页面", async t => {
  const env = createPanelPage(t, { pendingGet: true, cache: [{ id: "cached", title: "Cached", url: "https://cached.test", status: "unread" }] });
  await env.frame(); await env.frame();
  assert.ok(env.item("cached"));
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  env.releaseGet();
  await env.flush(); await env.frame(); await env.idleTurn();
  assert.equal(env.item("fresh"), null);
  assert.equal(env.store.laterOnPanelDiag, undefined);
});


test("语言读取挂起不阻塞缓存首屏，随后原地切换英文", async t => {
  let releaseLanguage;
  const language = new Promise(resolve => { releaseLanguage = resolve; });
  const env = createPanelPage(t, { pendingGet: true,
    cache: [{ id: "cached", title: "Cached", url: "https://cached.test", status: "unread" }],
    store: { laterOnItems: [{ id: "fresh", title: "Fresh", status: "unread", url: "https://fresh.test" }], laterOnSettings: { language: "en" } },
    setup(window) {
      const get = window.chrome.storage.local.get;
      window.chrome.storage.local.get = async keys => { if (keys === "laterOnSettings") await language; return get(keys); };
    }
  });
  await env.frame(); await env.frame();
  assert.ok(env.item("cached"), "不等待语言与完整收藏读取");
  assert.equal(env.document.querySelector("#bootSkeleton"), null);
  releaseLanguage();
  await env.until(() => env.document.querySelector("#searchInput").placeholder === "Search pages", "语言返回后更新 Vue 文字");
  assert.equal(env.document.querySelector("#itemCount").textContent, "1 pages");
  assert.ok(env.item("cached"));
  env.releaseGet(); await env.until(() => env.item("fresh"), "继续校准收藏");
});

test("筛选偏好写入失败保留本地结果，再次选择可以重试持久化", async t => {
  let fail = true;
  const env = createPanelPage(t, { setup(window) {
    const set = window.chrome.storage.local.set;
    window.chrome.storage.local.set = async patch => {
      if (Object.hasOwn(patch, "laterOnFilter") && fail) { fail = false; throw Error("preference unavailable"); }
      return set(patch);
    } } });
  await env.until(() => env.item("fresh"), "真实收藏首屏");
  const button = env.document.querySelector('.filter[data-filter="done"]');
  env.click(button); await env.flush();
  assert.equal(env.count(), 0);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(env.store.laterOnFilter, undefined);
  env.click(button); await env.flush();
  assert.equal(env.store.laterOnFilter, "done");
  assert.equal(env.store.laterOnFilterChosen, true);
});
