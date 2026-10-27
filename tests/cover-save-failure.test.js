// Run actual edit dialogs, page handlers and coordinator; only browser/image boundaries are simulated.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { JSDOM, VirtualConsole } = require("jsdom");
const read = require("./helpers/read-runtime.cjs");
const { createLibraryPage, makeItem } = require("./helpers/library-card-page.cjs");
const oldCover = "data:image/jpeg;base64,T0xE", newCover = "data:image/jpeg;base64,TkVX";

function sidepanel(t, options) {
  const errors = [], output = new VirtualConsole();
  output.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM(read("sidepanel.html"), { runScripts: "outside-only", pretendToBeVisual: true,
    url: "chrome-extension://fixture/sidepanel.html", virtualConsole: output });
  const { window } = dom;
  const store = structuredClone({ laterOnItems: options.items, laterOnProjects: [], laterOnCovers: options.covers,
    laterOnActiveProject: "unfiled", laterOnFilter: "all", laterOnFilterChosen: true, laterOnSettings: {} });
  let fail = false;
  const writes = [];
  window.scrollTo = () => {};
  window.chrome = {
    storage: { local: {
      async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key] ?? null]))); },
      async set(patch) {
        if (patch.laterOnItems) { if (fail) { fail = false; throw Error("write unavailable"); } writes.push(structuredClone(patch)); }
        Object.assign(store, structuredClone(patch)); // No own-write broadcast.
      }
    }, onChanged: { addListener() {} } },
    tabs: { async query() { return [{ id: 7, windowId: 3 }]; }, async getCurrent() { return { id: 7, windowId: 3 }; },
      onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
    windows: { async getCurrent() { return { id: 3 }; } },
    runtime: { getURL: file => "chrome-extension://fixture/" + file, async sendMessage() { return { ok: true }; }, onMessage: { addListener() {} } }
  };
  const scripts = new window.MutationObserver(records => {
    for (const script of records.flatMap(record => [...record.addedNodes]).filter(node => node.nodeName === "SCRIPT" && node.src)) {
      try { window.eval(read(new URL(script.src).pathname.slice(1))); script.dispatchEvent(new window.Event("load")); }
      catch { script.dispatchEvent(new window.Event("error")); }
    }
  });
  scripts.observe(window.document.head, { childList: true });
  window.eval(read("i18n.js")); require("./helpers/item-mutation")(window); window.eval(read("sidepanel-page.js"));
  t.after(() => { scripts.disconnect(); window.close(); assert.deepEqual(errors, []); });
  return { window, document: window.document, store, writes, failNextWrite() { fail = true; },
    card: id => window.document.querySelector('#items .item[data-id="' + id + '"]'),
    async until(condition, label) {
      for (let n = 0; n < 200; n++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.fail(label);
    } };
}
function imageBoundary(window) {
  Object.defineProperty(window.HTMLImageElement.prototype, "src", { configurable: true,
    get() { return this.getAttribute("src") || ""; },
    set(value) { this.setAttribute("src", value); window.setTimeout(() => this.onload?.(), 0); } });
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 1600 });
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 900 });
  window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => newCover;
}

for (const page of ["library", "sidepanel"]) test(page + ": 封面上传和移除写入失败保持图片与指针，重试原子提交且页面无广播更新", async t => {
  const options = { items: [makeItem("a", { image: "local://a" })], covers: { a: oldCover, other: oldCover } };
  const env = page === "library" ? createLibraryPage(t, options) : sidepanel(t, options);
  const { window, document, store } = env;
  imageBoundary(window);
  if (page === "library") {
    await env.until(() => document.querySelector('.project-nav[data-project="unfiled"]'), "navigation");
    document.querySelector('.project-nav[data-project="unfiled"]').click(); await env.flush();
  }
  await env.until(() => env.card("a"), "card loaded");
  const visible = () => document.querySelector(".lod-root:not([hidden])");
  const feedback = () => document.querySelector(page === "library" ? "#toast" : "#status").textContent;
  async function edit({ upload = false, remove = false } = {}) {
    env.card("a").querySelector(".edit").click(); await env.until(visible, "dialog visible");
    if (upload) {
      const input = visible().querySelector('input[type="file"]');
      Object.defineProperty(input, "files", { configurable: true, value: [new window.File([new Uint8Array([1, 2])], "cover.png", { type: "image/png" })] });
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await env.until(() => visible().querySelector(".lod-cover-preview img")?.getAttribute("src") === newCover, "uploaded preview");
      visible().querySelector('[data-field="title"]').value = "New title";
    }
    if (remove) visible().querySelector(".lod-cover-btn.is-plain").click();
    visible().querySelector(".lod-ok").click();
  }
  const before = structuredClone(store);
  env.failNextWrite(); await edit({ upload: true });
  await env.until(() => !visible() && feedback() === window.uiTest.i18n.t("operationFailed"), "failed upload");
  assert.deepEqual(store.laterOnItems, before.laterOnItems); assert.deepEqual(store.laterOnCovers, before.laterOnCovers);
  assert.equal(env.card("a").querySelector("h2").textContent, "Title a");
  assert.equal(env.card("a").querySelector(".cover-img, .thumb-img").getAttribute("src"), oldCover);
  await edit({ upload: true });
  await env.until(() => env.card("a").querySelector("h2").textContent === "New title", "successful upload without broadcast");
  assert.equal(store.laterOnItems[0].image, "local://a"); assert.equal(store.laterOnItems[0].imageEdited, true);
  assert.equal(store.laterOnCovers.a, newCover); assert.equal(store.laterOnCovers.other, oldCover);
  assert.equal(env.card("a").querySelector(".cover-img, .thumb-img").getAttribute("src"), newCover);
  const beforeRemove = structuredClone(store);
  env.failNextWrite(); await edit({ remove: true });
  await env.until(() => !visible() && feedback() === window.uiTest.i18n.t("operationFailed"), "failed removal");
  assert.deepEqual(store.laterOnItems, beforeRemove.laterOnItems); assert.deepEqual(store.laterOnCovers, beforeRemove.laterOnCovers);
  await edit({ remove: true });
  await env.until(() => !env.card("a").querySelector(".cover-img, .thumb-img"), "successful removal without broadcast");
  assert.equal(store.laterOnItems[0].image, ""); assert.equal(store.laterOnCovers.a, undefined); assert.equal(store.laterOnCovers.other, oldCover);
  const writes = env.writes.filter(patch => patch.laterOnItems);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].laterOnItems[0].image, "local://a"); assert.equal(writes[0].laterOnCovers.a, newCover);
  assert.equal(writes[1].laterOnItems[0].image, ""); assert.equal(writes[1].laterOnCovers.a, undefined);
});
