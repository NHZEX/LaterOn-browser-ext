// Execute the built Vue page and real storage coordinator; control browser boundaries only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const FakeTimers = require("@sinonjs/fake-timers");
const libraryPage = require("./library-page.cjs");
const read = require("./read-runtime.cjs");
const epoch = 1_760_000_000_000;
const makeItem = (id, overrides = {}) => ({ id, title: `Title ${id}`, description: "Description", source: "example.test",
  url: `https://example.test/${id}`, image: "", favicon: "", savedAt: epoch, status: "unread", projectId: null, ...overrides });

function createLibraryPage(t, { items = [makeItem("a")], projects = [], covers = {}, current = null, params = "", language = "zh-CN" } = {}) {
  const built = libraryPage();
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error.message));
  console.on("error", message => errors.push(String(message)));
  const dom = new JSDOM(built.html, { runScripts: "outside-only", pretendToBeVisual: true,
    url: `chrome-extension://fixture/library.html${params}`, virtualConsole: console });
  const { window } = dom;
  const clock = FakeTimers.withGlobal(window).install({ now: epoch,
    toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const store = structuredClone({ laterOnItems: items, laterOnProjects: projects, laterOnCovers: covers,
    laterOnCurrentItem: current, laterOnFilter: "all", laterOnFilterChosen: true, laterOnOnboardingSeen: true,
    laterOnSettings: { language, theme: "light", defaultSort: "newest", autoMarkRead: false } });
  const listeners = new Set();
  const idle = new Map(), frames = new Map();
  const commands = [], scrolled = [], opened = [], createdWindows = [];
  let sequence = 0, writeError = null, writeGate = null;
  window.fetch = async () => ({});
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.dataset.id); };
  window.requestIdleCallback = callback => { idle.set(++sequence, callback); return sequence; };
  window.cancelIdleCallback = id => idle.delete(id);
  window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.chrome = {
    storage: { local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return structuredClone(Object.fromEntries(names.filter(key => key in store).map(key => [key, store[key]])));
      },
      async set(patch) {
        if (writeGate && Object.hasOwn(patch, "laterOnItems")) {
          const gate = writeGate; writeGate = null; gate.started(); await gate.wait;
        }
        if (writeError && Object.hasOwn(patch, writeError)) { writeError = null; throw Error("write unavailable"); }
        Object.assign(store, structuredClone(patch)); // Deliberately no onChanged echo.
      }
    }, onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) } },
    runtime: { getURL: name => `chrome-extension://fixture/${name}`, onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type !== "COLLECTION_COMMAND") return { ready: true };
        commands.push(structuredClone(message));
        try { return await backend.LaterOnCollection.execute(message); }
        catch (error) { return { ok: false, error: error.message }; }
      } },
    tabs: { async getCurrent() { return { id: 1, windowId: 1 }; }, async query() { return [{ id: 1, windowId: 1 }]; },
      async update(id, patch) { opened.push({ id, ...patch }); return { id }; }, async create(patch) { opened.push(patch); return { id: 2 }; } },
    windows: { async getCurrent() { return { id: 1 }; }, async create(options) { createdWindows.push(structuredClone(options)); return { id: 2 }; } },
    sidePanel: { async open() {} }
  };
  const backend = vm.createContext({ chrome: window.chrome, crypto: window.crypto, Date, URL });
  vm.runInContext(read("storage-coordinator.js"), backend);
  t.after(() => {
    window.document.querySelector("#app").__vue_app__?.unmount();
    window.close(); clock.uninstall(); idle.clear(); frames.clear(); listeners.clear();
    assert.deepEqual(errors, [], "页面没有未处理异常");
  });
  const buildDir = path.resolve(__dirname, "../../.output/chrome-mv3");
  for (const script of window.document.querySelectorAll("script[src]:not([type='module'])")) {
    window.eval(fs.readFileSync(path.join(buildDir, new URL(script.src).pathname), "utf8"));
  }
  window.eval(built.script);

  const flush = () => clock.tickAsync(0);
  async function frame() {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(window.performance.now()));
    await clock.tickAsync(16);
  }
  async function idleTurn() {
    const callbacks = [...idle.values()]; idle.clear();
    callbacks.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
    await flush();
  }
  async function until(condition, label, { runIdle = false } = {}) {
    for (let turn = 0; turn < 100; turn++) {
      await flush();
      if (condition()) return;
      await frame();
      if (runIdle) await idleTurn();
    }
    assert.fail(`未达到预期状态：${label}`);
  }
  function broadcast(patch) {
    const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: structuredClone(store[key]), newValue: structuredClone(value) }]));
    Object.assign(store, structuredClone(patch));
    listeners.forEach(listener => listener(structuredClone(changes), "local"));
  }
  function holdNextWrite() {
    let release, started;
    const begun = new Promise(resolve => { started = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    writeGate = { wait, started };
    return { started: begun, release };
  }
  return { window, document: window.document, store, commands, scrolled, opened, createdWindows, clock, flush, frame, idleTurn, until, broadcast,
    pendingIdle: () => [...idle.values()], pendingFrames: () => [...frames.values()], failNextWrite: (key = "laterOnItems") => { writeError = key; }, holdNextWrite,
    card: id => window.document.querySelector(`#cardGrid .card[data-id="${id}"]`),
    ids: () => [...window.document.querySelectorAll("#cardGrid .card")].map(card => card.dataset.id),
    click: selector => { const element = window.document.querySelector(selector); assert.ok(element, selector); element.click(); },
    search: value => { const input = window.document.querySelector("#searchInput"); input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); }
  };
}

module.exports = { createLibraryPage, makeItem };
