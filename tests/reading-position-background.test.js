// 后台只给已收藏网页注入位置脚本，并用独立键保存 scrollY。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const urlSource = require("./helpers/read-runtime.cjs")("url-utils.js");
const source = fs.readFileSync(path.join(ROOT, "reading-position-background.js"), "utf8");
const store = {
  laterOnItems: [{ id: "a", url: "https://example.com/article?utm_source=x", title: "A" }],
  laterOnReadingPositions: { a: 720, orphan: 400 },
  laterOnSettings: { language: "en" }
};
const tab = { id: 7, active: true, windowId: 1, url: "https://example.com/article" };
const listeners = { storage: [], runtime: [] };
const injected = [];
const sent = [];
const chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map((key) => [key, store[key]]));
      },
      async set(patch) { Object.assign(store, patch); }
    },
    onChanged: { addListener(fn) { listeners.storage.push(fn); } }
  },
  tabs: {
    get: async () => tab,
    query: async () => [tab],
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); },
    onUpdated: { addListener(fn) { listeners.updated = fn; } },
    onActivated: { addListener(fn) { listeners.activated = fn; } }
  },
  scripting: { executeScript: async (details) => { injected.push(details); } },
  runtime: { onMessage: { addListener(fn) { listeners.runtime.push(fn); } } }
};
const sandbox = { chrome, URL, console, Promise, Object, Array, Set, Map, String, Number, Math };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(urlSource, sandbox, { filename: "url-utils.js" });
vm.runInContext(source, sandbox, { filename: "reading-position-background.js" });

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? `  → ${extra}` : ""}`);
  if (!ok) failures += 1;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

(async () => {
  listeners.updated(tab.id, { status: "complete" }, tab);
  await tick();
  check("只给已收藏网页注入位置脚本", injected[0]?.files?.[0] === "content-reading-position.js", JSON.stringify(injected[0]));
  check("把保存的位置和语言发给网页", sent[0]?.message?.itemId === "a" && sent[0]?.message?.y === 720 && sent[0]?.message?.language === "en", JSON.stringify(sent[0]));

  await new Promise((resolve) => listeners.runtime[0]({ type: "SAVE_READING_POSITION", itemId: "a", y: 965 }, {}, resolve));
  check("后台只保存纵向像素位置", store.laterOnReadingPositions.a === 965, JSON.stringify(store.laterOnReadingPositions));

  store.laterOnItems = [
    { id: "route-a", url: "https://routes.test/app#/article/1?b=2&a=1" },
    { id: "route-b", url: "https://routes.test/app#/article/2?a=1&b=2" }
  ];
  store.laterOnReadingPositions = { "route-a": 320, "route-b": 640 };
  tab.url = "https://routes.test/app#/article/1?a=1&b=2";
  listeners.updated(tab.id, { url: tab.url }, tab);
  await tick();
  check("同一路由参数换序仍定位自身阅读位置", sent.at(-1)?.message?.itemId === "route-a" && sent.at(-1)?.message?.y === 320);
  tab.url = "https://routes.test/app#/article/2?b=2&a=1";
  listeners.updated(tab.id, { url: tab.url }, tab);
  await tick();
  check("hash 路由变化后读取另一篇的位置", sent.at(-1)?.message?.itemId === "route-b" && sent.at(-1)?.message?.y === 640);
  tab.url = "https://routes.test/app#/article/3?a=1&b=2";
  listeners.updated(tab.id, { url: tab.url }, tab);
  await tick();
  check("未收藏的 hash 页面取消旧位置关联", sent.at(-1)?.message?.itemId === null);

  store.laterOnItems = [];
  listeners.storage.forEach((fn) => fn({ laterOnItems: { newValue: [] } }, "local"));
  await tick();
  check("收藏删除后位置记录也会清理", Object.keys(store.laterOnReadingPositions).length === 0, JSON.stringify(store.laterOnReadingPositions));

  console.log(failures ? `\n❌ 有 ${failures} 项失败` : "\n🎉 全部通过");
  if (failures) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
