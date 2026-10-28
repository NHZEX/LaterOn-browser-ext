const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const FakeTimers = require("@sinonjs/fake-timers");
const sourcePath = require("./helpers/source-path.cjs");
const source = require("./helpers/ui-modules.cjs");
const read = name => fs.readFileSync(sourcePath(name), "utf8");
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

function create(t, { language = "en", seen = false, force = false, pendingLanguage = false, pendingSeen = false, page = "library" } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><button id="origin">Origin</button></body></html>', {
    runScripts: "outside-only", pretendToBeVisual: true, url: `chrome-extension://fixture/${page}.html${force ? "?guide=1" : ""}`
  });
  const { window } = dom, store = { laterOnSettings: { language, theme: "dark" }, laterOnOnboardingSeen: seen };
  const clock = FakeTimers.withGlobal(window).install({ now: 0,
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
  const lang = gate(), viewed = gate(), writes = [], listeners = new Set();
  window.testOnboardingEnabled = true;
  window.chrome = { storage: { local: {
    async get(key) {
      const snapshot = structuredClone({ [key]: store[key] });
      if (key === "laterOnSettings" && pendingLanguage) await lang.promise;
      if (key === "laterOnOnboardingSeen" && pendingSeen) await viewed.promise;
      return snapshot;
    },
    async set(patch) { writes.push(structuredClone(patch)); Object.assign(store, structuredClone(patch)); }
  }, onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } } };
  window.eval(source);
  const origin = window.document.querySelector("#origin"); origin.focus();
  t.after(() => { window.dispatchEvent(new window.Event("pagehide")); clock.uninstall(); dom.window.close(); });
  return { window, document: window.document, api: window.uiTest, clock, store, writes, lang, viewed, listeners,
    flush: () => clock.tickAsync(0), guide: () => window.document.querySelector(".lon-guide"),
    click: selector => window.document.querySelector(selector).click(),
    key: key => window.document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })) };
}

test("模块词典、插值、语言持久化与初始读取竞争", async t => {
  const env = create(t, { pendingLanguage: true });
  const { i18n } = env.api;
  assert.deepEqual(Object.keys(i18n.dictionaries.en).sort(), Object.keys(i18n.dictionaries["zh-CN"]).sort());
  const update = { laterOnSettings: { newValue: { language: "zh-CN" } } };
  env.listeners.forEach(fn => fn(update, "local"));
  env.lang.release(); await i18n.ready;
  assert.equal(env.document.documentElement.lang, "zh-CN", "迟到初始读取不能覆盖更新通知");
  assert.equal(i18n.t("guideStepSaveTitle"), "一键添加，随时继续浏览");
  await i18n.setLanguage("en");
  assert.equal(i18n.t("cardCount", { n: 3 }), "3 pages");
  assert.equal(i18n.t("unknown-key"), "unknown-key");
  assert.equal(env.store.laterOnSettings.theme, "dark");
  assert.equal(env.store.laterOnSettings.language, "en");
  assert.equal(env.window.LaterOnI18n, undefined);
  assert.equal(env.window.LaterOnDialog, undefined);
  assert.equal(env.window.LaterOnOnboarding, undefined);
});

test("首次引导等待语言就绪，三步完成只记一次已读并恢复焦点", async t => {
  const env = create(t, { pendingLanguage: true });
  const stop = env.api.onboarding.initOnboarding(); t.after(stop);
  await env.clock.tickAsync(1000); assert.equal(env.guide(), null);
  env.lang.release(); await env.flush(); await env.clock.tickAsync(219); assert.equal(env.guide(), null);
  await env.clock.tickAsync(1);
  assert.equal(env.guide().querySelector("h2").textContent, "Add now, continue anytime");
  assert.equal(env.document.activeElement.getAttribute("role"), "dialog");
  assert.equal(env.key("Enter"), false, "拦截默认按钮激活，不能重复跳步");
  env.key("Enter"); await env.clock.tickAsync(200);
  assert.equal(env.guide().querySelector("h2").textContent, "Keep things tidy with projects");
  env.click(".lon-guide-next"); await env.clock.tickAsync(200);
  assert.equal(env.guide().querySelector(".lon-guide-next").textContent, "Get started");
  env.key("Enter"); env.key("Escape"); await env.clock.tickAsync(200);
  assert.equal(env.guide(), null); assert.equal(env.document.activeElement.id, "origin");
  assert.equal(env.writes.filter(patch => patch.laterOnOnboardingSeen).length, 1);
});

test("已看过不自动打开，guide=1 重播；重复打开和销毁清理过渡与监听", async t => {
  const seen = create(t, { seen: true }); const stopSeen = seen.api.onboarding.initOnboarding(); t.after(stopSeen);
  await seen.clock.tickAsync(1000); assert.equal(seen.guide(), null);
  const env = create(t, { seen: true, force: true }); const stop = env.api.onboarding.initOnboarding(); t.after(stop);
  await env.clock.tickAsync(250); assert.ok(env.guide());
  env.click(".lon-guide-next");
  const old = env.guide(); const dispose = env.api.onboarding.openOnboarding();
  assert.equal(old.isConnected, false); assert.equal(env.document.querySelectorAll(".lon-guide").length, 1);
  await env.clock.tickAsync(250); assert.equal(env.guide().querySelector("h2").textContent, "Add now, continue anytime");
  env.click(".lon-guide-next"); dispose();
  old.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await env.clock.tickAsync(1000); assert.equal(env.guide(), null); assert.equal(env.writes.length, 0);
});

test("在语言读取、已读读取、延迟打开及过渡期间销毁均不产生迟到 UI 或已读写入", async t => {
  for (const phase of ["language", "seen", "delay", "transition"]) {
    const env = create(t, { pendingLanguage: phase === "language", pendingSeen: phase === "seen" });
    const stop = env.api.onboarding.initOnboarding(); await env.flush();
    if (phase === "transition") { await env.clock.tickAsync(250); env.click(".lon-guide-next"); }
    stop(); env.lang.release(); env.viewed.release(); await env.clock.tickAsync(2000);
    assert.equal(env.guide(), null, phase); assert.equal(env.writes.length, 0, phase);
  }
});

test("弹窗 dispose 取消当前和排队表单，迟到动画不复活，之后仍可正常打开", async t => {
  const env = create(t); await env.api.i18n.ready;
  const first = env.api.dialog.confirm("First");
  const queued = env.api.dialog.prompt({ title: "Queued", fields: [{ name: "title", label: "Title", value: "Draft" }] });
  await env.flush(); assert.equal(env.document.querySelector(".lod-title").textContent, "");
  env.api.dialog.dispose();
  assert.equal(await first, false); assert.equal(await queued, false);
  await env.clock.tickAsync(1000); assert.equal(env.document.querySelector(".lod-root"), null);
  const retry = env.api.dialog.confirm({ title: "Retry" }); await env.flush();
  assert.equal(env.document.querySelector(".lod-title").textContent, "Retry");
  env.api.dialog.close(); await env.clock.tickAsync(250); assert.equal(await retry, false);
});

test("并发 epoch 错误第二条提示显示时卸载，取消剩余队列且两个命令均拒绝", async t => {
  const env = create(t, { page: "unit" }); await env.api.i18n.ready;
  env.window.chrome.runtime = { sendMessage: async () => ({ ok: false, error: "STALE_COLLECTION" }) };
  env.window.eval(require("./helpers/read-runtime.cjs")("storage-client.js"));
  env.window.LaterOnStorage.initialize({});
  const stop = env.api.bindStorageFeedback(async () => env.api.dialog);
  const first = env.window.LaterOnStorage.run("migrateLegacyData").catch(error => error.message);
  const second = env.window.LaterOnStorage.run("migrateLegacyData").catch(error => error.message);
  await env.flush(); env.click(".lod-ok"); await env.clock.tickAsync(250);
  assert.equal(env.api.dialog.isOpen(), true);
  stop(); await env.flush();
  assert.equal(await first, "STALE_COLLECTION"); assert.equal(await second, "STALE_COLLECTION");
  assert.equal(env.document.querySelector(".lod-root"), null);
});

test("销毁后的迟到图片解码不能覆盖下一弹窗的封面", async t => {
  const env = create(t); await env.api.i18n.ready;
  let decode;
  env.window.FileReader = class {
    readAsDataURL() { this.result = "data:image/png;base64,pending"; this.onload(); }
  };
  env.window.Image = class {
    naturalWidth = 10; naturalHeight = 10;
    set src(value) { decode = () => this.onload(); }
  };
  env.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  env.window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,old";
  const first = env.api.dialog.prompt({ title: "Old", cover: { name: "cover", value: "" } });
  await env.flush();
  const input = env.document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [new env.window.File(["image"], "cover.png", { type: "image/png" })] });
  input.dispatchEvent(new env.window.Event("change", { bubbles: true }));
  assert.equal(typeof decode, "function");
  env.api.dialog.dispose(); assert.equal((await first).ok, false);
  const currentCover = "https://example.test/new.jpg";
  const second = env.api.dialog.prompt({ title: "New", cover: { name: "cover", value: currentCover } });
  await env.flush(); decode(); await env.flush();
  assert.equal(env.document.querySelector(".lod-cover-preview img").src, currentCover);
  env.click(".lod-ok"); await env.clock.tickAsync(250);
  assert.equal((await second).values.cover, currentCover);
});

test("收藏库在首次语言读取返回前卸载，不再迟到挂载页面或引导", async t => {
  const page = require("./helpers/library-page.cjs")();
  const env = create(t, { pendingLanguage: true });
  env.document.body.innerHTML = '<div id="app"></div>';
  env.window.fetch = async () => ({});
  env.window.eval(page.script);
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  env.lang.release(); await env.clock.tickAsync(1000);
  assert.equal(env.document.querySelector("#app").hasAttribute("data-v-app"), false);
  assert.equal(env.guide(), null); assert.equal(env.writes.length, 0);
});

const manifest = JSON.parse(read("manifest.json"));
assert.strictEqual(manifest.default_locale, "zh_CN");
assert.match(manifest.name, /^__MSG_/);
for (const locale of ["zh_CN", "en"]) {
  const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
  for (const key of ["extensionName", "extensionDescription", "actionTitle", "commandSavePage", "commandTranslatePage", "commandSaveAllTabs"]) {
    assert.ok(messages[key]?.message, `${locale} 缺少 ${key}`);
  }
}
assert.strictEqual(JSON.parse(read("_locales/zh_CN/messages.json")).extensionName.message, "StaySide · 项目型网页管理");
