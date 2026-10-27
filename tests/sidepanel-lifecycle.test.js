const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage, makeItem, makeStore } = require("./helpers/panel-page.cjs");

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tab = (id, title = `Tab ${id}`) => ({ id, title, active: true, windowId: 7, url: `https://page.test/${id}` });
const title = env => env.document.querySelector("#currentTitle").textContent;
const source = env => env.document.querySelector("#currentSource").textContent;
const save = env => env.document.querySelector("#saveCurrent");
const status = env => env.document.querySelector("#status").textContent;
const activate = env => env.activated.forEach(listener => listener({ tabId: 2, windowId: 7 }));

test("无动画帧 API 时仍通过定时降级完成启动和缓存首屏", async t => {
  const env = createPanelPage(t, { cache: [makeItem({ id: "cached" })], pendingGet: true, setup(window) {
    window.requestAnimationFrame = undefined;
  } });
  await env.clock.tickAsync(17);
  assert.ok(env.item("cached")); assert.equal(env.document.querySelector("#bootSkeleton"), null);
  env.releaseGet(); await env.until(() => env.item("fresh"), "定时降级后校准真实集合");
});

test("当前页缩略图按 YouTube 降级链试载，耗尽时保留 Logo", async t => {
  const probes = [];
  const env = createPanelPage(t, { setup(window) {
    window.Image = class { constructor() { probes.push(this); } };
    window.chrome.runtime.sendMessage = async () => ({ ok: true, metadata: { image: "https://i.ytimg.com/vi/E4/maxresdefault.jpg" } });
  } });
  await env.until(() => probes.length === 1, "开始试载原封面");
  for (const file of ["hq720", "hqdefault", "mqdefault"]) {
    probes.at(-1).onerror(); await env.flush();
    assert.equal(probes.at(-1).src, `https://i.ytimg.com/vi/E4/${file}.jpg`);
  }
  probes.at(-1).onerror(); await env.flush();
  const thumb = env.document.querySelector("#currentThumb");
  assert.equal(thumb.classList.contains("has-cover"), false); assert.equal(thumb.style.backgroundImage, "");
  assert.ok(thumb.querySelector(".thumb-logo"));
});

test("启动读取返回旧快照时保留等待期间的外部广播和本地筛选（无自身广播）", async t => {
  const gate = deferred();
  const env = createPanelPage(t, { cache: [makeItem({ id: "cached" })], setup(window) {
    const get = window.chrome.storage.local.get;
    window.chrome.storage.local.get = async keys => {
      const result = await get(keys);
      if (Array.isArray(keys) && keys.includes("laterOnItems")) await gate.promise;
      return result;
    };
  } });
  await env.until(() => env.item("cached"), "缓存先显示");
  env.click(env.document.querySelector('[data-filter="done"]')); await env.flush();
  env.broadcast({ laterOnItems: [makeItem({ id: "new", status: "done" })] });
  gate.resolve();
  await env.until(() => env.item("new"), "保留最新条目和本地筛选");
  assert.equal(env.item("fresh"), null); assert.equal(env.item("cached"), null);
  assert.equal(env.document.querySelector('[data-filter="done"]').getAttribute("aria-pressed"), "true");
  assert.equal(env.store.laterOnFilter, "done");
});

for (const externalLast of [false, true]) test(`初始化等待期间按最后一次选择恢复筛选：${externalLast ? "外部" : "本地"}最后`, async t => {
  const env = createPanelPage(t, { pendingGet: true, cache: [makeItem({ id: "cached" })] });
  await env.until(() => env.item("cached"), "缓存可操作");
  const local = () => env.click(env.document.querySelector('[data-filter="done"]'));
  const external = () => env.broadcast({ laterOnFilter: "all", laterOnFilterChosen: true });
  if (externalLast) { local(); external(); } else { external(); local(); }
  await env.flush(); env.releaseGet(); await env.until(() => env.store.laterOnPanelDiag, "存储校准完成");
  assert.equal(env.document.querySelector(`[data-filter="${externalLast ? "all" : "done"}"]`).getAttribute("aria-pressed"), "true");
});

test("首屏后的封面旧读取不能覆盖等待期间更新的封面广播", async t => {
  const gate = deferred(); let reading = false;
  const env = createPanelPage(t, { store: { ...makeStore([makeItem({ image: "local://fresh" })]), laterOnCovers: { fresh: "data:image/png;base64,OLD" } }, setup(window) {
    const get = window.chrome.storage.local.get;
    window.chrome.storage.local.get = async keys => {
      const result = await get(keys);
      if (keys === "laterOnCovers") { reading = true; await gate.promise; }
      return result;
    };
  } });
  await env.until(() => reading, "首屏后独立读封面");
  env.broadcast({ laterOnCovers: { fresh: "data:image/png;base64,NEW" } }); await env.flush();
  gate.resolve(); await env.flush();
  assert.equal(env.item("fresh").querySelector(".thumb-img").getAttribute("src"), "data:image/png;base64,NEW");
});

test("挂起元数据不阻塞当前网页添加，四秒后保留降级资料且忽略迟到响应", async t => {
  const metadata = deferred(), requests = [];
  const env = createPanelPage(t, { setup(window) {
    window.chrome.tabs.query = async () => [tab(1, "Immediate title")];
    window.chrome.runtime.sendMessage = async message => { requests.push(message); return message.type === "EXTRACT_METADATA" ? metadata.promise : { ok: true }; };
  } });
  await env.until(() => title(env) === "Immediate title" && !save(env).disabled, "标签页资料立即可用");
  assert.deepEqual(structuredClone(requests[0]), { type: "EXTRACT_METADATA", tabId: 1 });
  await env.clock.tickAsync(4001);
  metadata.resolve({ ok: true, metadata: { title: "Too late" } }); await env.flush();
  assert.equal(title(env), "Immediate title"); assert.equal(source(env), "page.test");
  env.click(save(env)); await env.flush();
  assert.equal(save(env).classList.contains("saved"), true);
});

test("快速切页使旧标签查询和元数据失效，旧图片回调不能污染新缩略图", async t => {
  const oldQuery = deferred(), metadata = deferred(), probes = []; let active = tab(1), query = 0;
  const env = createPanelPage(t, { setup(window) {
    window.Image = class { constructor() { probes.push(this); } };
    window.chrome.tabs.query = () => ++query === 1 ? oldQuery.promise : Promise.resolve([active]);
    window.chrome.runtime.sendMessage = async message => message.tabId === 2 ? metadata.promise
      : { ok: true, metadata: { title: `Metadata ${message.tabId}`, image: `https://image.test/${message.tabId}.png` } };
  } });
  await env.until(() => query === 1, "第一次标签查询挂起");
  active = tab(2); activate(env); await env.until(() => title(env) === "Tab 2", "切到第二页");
  oldQuery.resolve([tab(1)]); await env.flush(); assert.equal(title(env), "Tab 2");
  active = tab(3); activate(env); await env.until(() => probes.length === 1, "第三页封面探测");
  const staleLoad = probes[0].onload;
  active = tab(4); activate(env); await env.until(() => probes.length === 2, "第四页封面探测");
  staleLoad(); await env.flush();
  assert.equal(env.document.querySelector("#currentThumb").classList.contains("has-cover"), false);
  probes[1].onload(); await env.flush();
  assert.ok(env.document.querySelector("#currentThumb").style.backgroundImage.includes("/4.png"));
  metadata.resolve({ ok: true, metadata: { title: "Old metadata" } }); await env.flush();
  assert.equal(title(env), "Metadata 4");
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  staleLoad(); await env.clock.tickAsync(5000);
  assert.equal(env.document.querySelector("#currentThumb"), null);
});

test("当前页收藏失败可重试，项目选择等待不误标成功，保存中不重复发送", async t => {
  const gate = deferred(), requests = []; let response = { ok: false, error: "Try again" };
  const env = createPanelPage(t, { setup(window) {
    window.chrome.tabs.query = async () => [tab(1)];
    window.chrome.runtime.sendMessage = async message => {
      if (message.type === "EXTRACT_METADATA") return { ok: false };
      requests.push(structuredClone(message)); return response ?? gate.promise;
    };
  } });
  await env.until(() => !save(env).disabled, "添加入口可用");
  env.click(save(env)); await env.flush(); assert.equal(status(env), "Try again"); assert.equal(save(env).disabled, false);
  response = { ok: true, pending: true }; env.click(save(env)); await env.flush();
  assert.equal(status(env), env.window.uiTest.i18n.t("pickerOpened")); assert.equal(save(env).classList.contains("saved"), false);
  response = null; env.click(save(env)); env.click(save(env)); await env.flush();
  assert.equal(requests.length, 3); assert.equal(save(env).disabled, true);
  assert.deepEqual(requests[2], { type: "QUICK_SAVE_TAB", source: "panel", tabId: 1 });
  gate.resolve({ ok: true }); await env.flush(); assert.equal(save(env).classList.contains("saved"), true); assert.equal(status(env), "");
});

test("保存成功不被随后补齐的元数据撤销，切页后旧保存失败不改变新页面", async t => {
  const metadata = deferred(), saving = deferred(); let active = tab(1), attempt = 0;
  const env = createPanelPage(t, { setup(window) {
    window.chrome.tabs.query = async () => [active];
    window.chrome.runtime.sendMessage = async message => message.type === "EXTRACT_METADATA" ? metadata.promise
      : ++attempt === 1 ? { ok: true } : saving.promise;
  } });
  await env.until(() => !save(env).disabled, "降级页面可添加");
  env.click(save(env)); await env.flush();
  metadata.resolve({ ok: true, metadata: { title: "Complete title" } }); await env.flush();
  assert.equal(title(env), "Complete title"); assert.equal(save(env).classList.contains("saved"), true);
  active = tab(2); activate(env); await env.until(() => !save(env).disabled, "切换新页面");
  env.click(save(env)); await env.flush();
  active = tab(3); activate(env); await env.flush();
  saving.resolve({ ok: false, error: "Old failure" }); await env.flush();
  assert.equal(status(env), ""); assert.equal(save(env).disabled, false); assert.equal(save(env).classList.contains("saved"), false);
});

for (const [url, key] of [["file:///C:/notes.txt", "localFileUnsupported"], ["chrome://settings", "browserPageUnsupported"]]) {
  test(`不支持的当前页禁用添加并说明原因：${url}`, async t => {
    let requests = 0;
    const env = createPanelPage(t, { setup(window) {
      window.chrome.tabs.query = async () => [{ ...tab(1), url }];
      window.chrome.runtime.sendMessage = async () => { requests++; return { ok: true }; };
    } });
    await env.until(() => source(env) === env.window.uiTest.i18n.t(key), "显示限制说明");
    assert.equal(save(env).disabled, true); env.click(save(env)); await env.flush(); assert.equal(requests, 0);
  });
}

test("展开完整界面失败可重试，打开成功后关闭失败才降级关闭本页", async t => {
  let success = false, closed = 0, fallback = 0, requests = 0;
  const env = createPanelPage(t, { setup(window) {
    window.chrome.runtime.sendMessage = async message => {
      if (message.type !== "OPEN_LIBRARY") return { ok: false };
      requests++; return { ok: success };
    };
    window.chrome.sidePanel = { close: async () => { closed++; throw Error("Unsupported close"); } };
    window.close = () => { fallback++; };
  } });
  await env.until(() => env.store.laterOnPanelDiag, "初始化完成");
  const button = env.document.querySelector("#openLibrary");
  env.click(button); await env.flush(); assert.equal(closed, 0); assert.equal(fallback, 0);
  assert.equal(status(env), env.window.uiTest.i18n.t("libraryOpenFailed")); assert.equal(button.disabled, false);
  success = true; env.click(button); env.click(button); await env.flush();
  assert.equal(requests, 2); assert.equal(closed, 1); assert.equal(fallback, 1);
});

test("卸载后迟到的窗口、元数据和展开查询不再应答、导航或写入", async t => {
  const windowInfo = deferred(), query = deferred(), metadata = deferred(); let calls = 0, opens = 0, response;
  const env = createPanelPage(t, { setup(window) {
    window.chrome.windows.getCurrent = () => windowInfo.promise;
    window.chrome.tabs.query = () => ++calls === 1 ? Promise.resolve([tab(1)]) : query.promise;
    window.chrome.runtime.sendMessage = message => { if (message.type === "OPEN_LIBRARY") opens++; return metadata.promise; };
  } });
  await env.until(() => !save(env).disabled, "元数据等待中仍可用");
  [...env.messages][0]({ type: "PING_SIDEPANEL", windowId: 7 }, {}, value => { response = value; });
  env.click(env.document.querySelector("#openLibrary")); await env.flush();
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  const stored = structuredClone(env.store);
  windowInfo.resolve({ id: 7 }); query.resolve([tab(1)]); metadata.resolve({ ok: true, metadata: { title: "Late" } });
  await env.clock.tickAsync(5000);
  assert.equal(response, undefined); assert.equal(opens, 0); assert.deepEqual(env.store, stored);
  assert.equal(env.messages.size, 0); assert.equal(env.activated.size, 0); assert.equal(env.updated.size, 0);
});
