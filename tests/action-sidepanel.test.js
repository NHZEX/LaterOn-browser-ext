const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const read = require("./helpers/read-runtime.cjs");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));

function background(sidePanel) {
  const events = {};
  const event = name => ({ addListener(listener) { (events[name] ??= []).push(listener); } });
  const store = { laterOnItems: [], laterOnCleanupV165: true, laterOnSettings: {} }, created = [];
  const chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, structuredClone(store[key])])); },
      async set(patch) { Object.assign(store, structuredClone(patch)); }, async remove() {}
    }, onChanged: event("storage") },
    runtime: { getURL: name => `chrome-extension://fixture/${name}`, onMessage: event("messages"), onInstalled: event("installed"), onStartup: event("startup") },
    tabs: { query: async () => [], create: async info => { created.push(structuredClone(info)); return { id: 2, ...info }; }, onActivated: event("activated"), onUpdated: event("updated"), onRemoved: event("removed") },
    windows: {}, action: {}, sidePanel,
    contextMenus: { removeAll(callback) { callback?.(); }, create() {}, onClicked: event("menus") },
    commands: { onCommand: event("commands") }, alarms: { create() {}, onAlarm: event("alarms") }
  };
  const context = vm.createContext({ chrome, URL, console, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(read(file), context, { filename: file }));
  context.importScripts("background.js");
  return { events, created };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("工具栏配置与真实后台冷启动、安装和浏览器启动都启用原生侧栏", async () => {
  assert.ok(manifest.action);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel?.default_path, "sidepanel.html");
  const calls = [];
  const env = background({ setPanelBehavior: async options => { calls.push(structuredClone(options)); } });
  await flush(); assert.deepEqual(calls, [{ openPanelOnActionClick: true }]);
  for (const name of ["installed", "startup"]) {
    env.events[name].forEach(listener => listener()); await flush();
    assert.equal(calls.length, name === "installed" ? 2 : 3);
    assert.deepEqual(calls.at(-1), { openPanelOnActionClick: true });
  }
});

for (const sidePanel of [undefined, {}, { setPanelBehavior: async () => { throw Error("Unavailable"); } }]) {
  test("原生侧栏 API 缺失或拒绝时，后台仍注册并处理完整界面入口", async () => {
    const env = background(sidePanel); await flush();
    for (const name of ["installed", "startup"]) env.events[name].forEach(listener => listener());
    const response = await new Promise(resolve => env.events.messages.forEach(listener => listener({ type: "OPEN_LIBRARY", context: {
      source: "sidepanel", projectId: "research", filter: "done", focusItemId: "article"
    } }, {}, resolve)));
    assert.equal(response.ok, true);
    const url = new URL(env.created[0].url);
    assert.equal(url.pathname, "/library.html");
    assert.deepEqual(Object.fromEntries(url.searchParams), { from: "sidepanel", project: "research", filter: "done", focus: "article" });
    await flush();
  });
}
