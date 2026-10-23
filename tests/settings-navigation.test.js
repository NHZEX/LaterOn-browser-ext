// 「打开设置」和「从设置返回」的导航行为测试。覆盖：
//  1) 在收藏墙点「设置」→ 在「当前标签页」切过去，不再多开一个标签
//  2) 按住 ⌘ / Ctrl / Shift 点 → 仍在新标签页打开（保留老习惯）
// 设置页返回、品牌与引导行为由构建产物测试覆盖。
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const libraryHtml = require("./helpers/read-runtime.cjs")("library.html");
const librarySource = require("./helpers/read-runtime.cjs")("library-page.js");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
// jsdom 不真的实现导航，改地址时会报「Not implemented: navigation」，这类噪音要滤掉。
const realErrors = (list) => list.filter((e) => !/Not implemented: navigation/.test(e));

function makeVirtualConsole(sink) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => sink.push(String(error?.message || error)));
  vc.on("error", (message) => sink.push(String(message)));
  return vc;
}

function makeChrome(window, store, extra = {}) {
  return {
    storage: {
      local: {
        get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return Promise.resolve(out);
        },
        set(patch) { Object.assign(store, patch); return Promise.resolve(); }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      getCurrent: () => Promise.resolve({ id: 1, windowId: 7 }),
      get: (id) => Promise.resolve({ id }),
      query: () => Promise.resolve([{ id: 1, windowId: 7, active: true, url: "chrome-extension://lateron/library.html" }]),
      update: (id, options) => { extra.updated.push({ id, ...options }); return Promise.resolve({ id }); },
      create: (options) => { extra.created.push(options); return Promise.resolve({ id: 9 }); },
      remove: (id) => { extra.removed.push(id); return Promise.resolve(); },
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      onCreated: { addListener() {} }
    },
    windows: { getCurrent: () => Promise.resolve({ id: 7 }) },
    sidePanel: { open: () => Promise.resolve() },
    commands: { getAll: () => Promise.resolve([]) },
    runtime: {
      getURL: (path) => `chrome-extension://lateron/${path}`,
      sendMessage: () => Promise.resolve({ ok: false, ready: true }),
      onMessage: { addListener() {} }
    }
  };
}

(async () => {
  console.log("── 第 1 步：收藏墙点「设置」→ 在当前标签页切过去 ──");
  {
    const errors = [];
    const dom = new JSDOM(libraryHtml, {
      runScripts: "outside-only", pretendToBeVisual: true,
      url: "chrome-extension://lateron/library.html",
      virtualConsole: makeVirtualConsole(errors)
    });
    const { window } = dom;
    const logs = { updated: [], created: [], removed: [] };
    window.chrome = makeChrome(window, { laterOnItems: [], laterOnProjects: [], laterOnSettings: {} }, logs);
    if (typeof window.crypto?.randomUUID !== "function") {
      Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "fake-" + Math.random().toString(36).slice(2) } });
    }
    require('./helpers/item-mutation')(window);
    window.eval(librarySource);
    await tick();

    const settingsButton = window.document.querySelector("#openSettings");
    check("收藏墙上有「设置」入口", !!settingsButton);
    settingsButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();

    check("没有新开标签页", logs.created.length === 0, `新开了 ${logs.created.length} 个`);
    check("当前标签页被切到设置页", logs.updated.length === 1 && /settings\.html$/.test(logs.updated[0].url || ""), JSON.stringify(logs.updated));
    check("全程没有报错", realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(" | "));
    dom.window.close();
  }

  console.log("\n── 第 2 步：按住 ⌘ / Ctrl / Shift 点 → 仍在新标签页打开 ──");
  {
    const errors = [];
    const dom = new JSDOM(libraryHtml, {
      runScripts: "outside-only", pretendToBeVisual: true,
      url: "chrome-extension://lateron/library.html",
      virtualConsole: makeVirtualConsole(errors)
    });
    const { window } = dom;
    const logs = { updated: [], created: [], removed: [] };
    window.chrome = makeChrome(window, { laterOnItems: [], laterOnProjects: [], laterOnSettings: {} }, logs);
    if (typeof window.crypto?.randomUUID !== "function") {
      Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "fake-" + Math.random().toString(36).slice(2) } });
    }
    require('./helpers/item-mutation')(window);
    window.eval(librarySource);
    await tick();

    window.document.querySelector("#openSettings")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    await tick();
    check("新开了一个标签页到设置页", logs.created.length === 1 && /settings\.html$/.test(logs.created[0].url || ""), JSON.stringify(logs.created));
    check("当前标签页没被切走", logs.updated.length === 0);
    check("全程没有报错", realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(" | "));
    dom.window.close();
  }

  console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
