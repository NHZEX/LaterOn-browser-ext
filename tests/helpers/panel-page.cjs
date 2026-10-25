// Isolated browser boundaries; page, dialogs and storage coordinator stay real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const FakeTimers = require("@sinonjs/fake-timers");
const installMutations = require("./item-mutation");

const root = path.resolve(__dirname, "../..");
const defaultRead = require("./read-runtime.cjs");
const epoch = 1_760_000_000_000;
const clone = (value) => structuredClone(value);
const makeItem = (overrides = {}) => ({
  id: "fresh", title: "存储里的新标题", description: "摘要", image: "", favicon: "",
  source: "x.com", projectId: null, url: "https://x.com", savedAt: epoch,
  status: "unread", ...overrides
});
const makeStore = (items = [makeItem()]) => ({
  laterOnItems: items, laterOnProjects: [], laterOnActiveProject: "all",
  laterOnSettings: {}, laterOnCovers: {}
});

function createPanelPage(t, {
  store: initialStore = makeStore(), cache = null, pendingGet = false,
  getError = null, broadcast = false, slowCacheMs = 0, pageDelayMs = 0,
  panel = true, directory, setup = () => {}
} = {}) {
  const built = directory ? require("./library-page.cjs")(directory, "sidepanel") : null;
  const read = built ? file => file === "sidepanel.html" ? built.html : file === "sidepanel-page.js" ? built.script
    : fs.readFileSync(path.join(directory, file), "utf8") : defaultRead;
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  console.on("error", (message) => errors.push(String(message)));
  const dom = new JSDOM(read("sidepanel.html"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "chrome-extension://lateron/sidepanel.html", virtualConsole: console
  });
  const { window } = dom;
  const clock = FakeTimers.withGlobal(window).install({
    now: epoch,
    toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"]
  });
  const frames = new Map();
  const idle = new Map();
  const listeners = new Set();
  const messages = new Set(), activated = new Set(), updated = new Set();
  const event = listeners => ({ addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) });
  const store = clone(initialStore);
  const calls = [];
  const cacheWrites = [];
  const memory = new Map(cache === null ? [] : [["laterOnPanelCache", JSON.stringify(cache)]]);
  let sequence = 0;
  let releaseGet;
  let writeError = null;
  let storageCost = 0;
  const gate = pendingGet ? new Promise((resolve) => { releaseGet = resolve; }) : Promise.resolve();
  const performanceNow = window.performance.now.bind(window.performance);
  window.performance.now = () => performanceNow() + storageCost;
  window.scrollTo = () => {};
  window.requestAnimationFrame = (callback) => { frames.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.requestIdleCallback = (callback) => { idle.set(++sequence, callback); return sequence; };
  window.cancelIdleCallback = (id) => idle.delete(id);
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem(key) {
      if (key === "laterOnPanelCache") {
        calls.push("cache");
        // Represent synchronous I/O cost without a machine-dependent busy-wait.
        storageCost += slowCacheMs;
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      if (key === "laterOnPanelCache") cacheWrites.push(String(value));
      memory.set(key, String(value));
    },
    removeItem: (key) => memory.delete(key)
  } });
  window.chrome = {
    storage: {
      local: {
        async get(keys = null) {
          const names = keys === null ? Object.keys(store)
            : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          if (names.includes("laterOnItems")) {
            calls.push("storage");
            await gate;
            if (getError) throw new Error(getError);
          }
          const defaults = keys && !Array.isArray(keys) && typeof keys === "object" ? clone(keys) : {};
          return Object.assign(defaults, clone(Object.fromEntries(
            names.filter((key) => Object.hasOwn(store, key)).map((key) => [key, store[key]])
          )));
        },
        async set(patch) {
          if (writeError && Object.hasOwn(patch, "laterOnItems")) {
            const error = writeError;
            writeError = null;
            throw new Error(error);
          }
          const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) =>
            [key, { oldValue: clone(store[key]), newValue: clone(value) }]));
          Object.assign(store, clone(patch));
          if (broadcast) window.setTimeout(() => {
            listeners.forEach((listener) => listener(clone(changes), "local"));
          }, 0);
        }
      },
      onChanged: { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) }
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 7, active: true, url: "https://current.com" }],
      update: async () => ({}), onActivated: event(activated), onUpdated: event(updated)
    },
    windows: { getCurrent: async () => ({ id: 7 }) },
    runtime: {
      getURL: (file) => `chrome-extension://lateron/${file}`,
      sendMessage: async () => ({ ok: false }), onMessage: event(messages)
    }
  };
  setup(window);
  // Register cleanup before executing scripts, including when an assertion fails.
  t.after(() => {
    window.dispatchEvent(new window.Event("pagehide"));
    dom.window.close();
    clock.uninstall();
    frames.clear();
    idle.clear();
    listeners.clear();
    assert.deepEqual(errors, [], "页面不应产生未处理异常");
  });
  window.eval(read("boot.js"));
  clock.tick(pageDelayMs);
  if (panel) {
    window.eval(read("dialog.js"));
    installMutations(window, read);
    window.eval(read("i18n.js"));
    window.eval(read("url-utils.js"));
    window.eval(read("tab-navigation.js"));
    window.eval(read("sidepanel-page.js"));
  }

  const flush = () => clock.tickAsync(1);
  async function frame(ms = 16) {
    await clock.tickAsync(ms);
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(window.performance.now()));
    await flush();
  }
  async function idleTurn() {
    const callbacks = [...idle.values()];
    idle.clear();
    callbacks.forEach((callback) => callback({ didTimeout: false, timeRemaining: () => 50 }));
    await flush();
  }
  async function until(condition, label, { runIdle = true } = {}) {
    // Scheduler turns are a hang guard, not a wall-clock performance requirement.
    for (let turn = 0; turn < 100; turn += 1) {
      await flush();
      if (condition()) return;
      await frame();
      if (runIdle) await idleTurn();
    }
    assert.fail(`未达到预期状态：${label}`);
  }
  return {
    window, document: window.document, store, calls, cacheWrites, clock, listeners, messages, activated, updated,
    broadcast(patch) {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: clone(store[key]), newValue: clone(value) }]));
      Object.assign(store, clone(patch));
      listeners.forEach(listener => listener(changes, "local"));
    },
    frame, idleTurn, until, flush, releaseGet: () => releaseGet?.(),
    pendingIdle: () => [...idle.values()],
    pendingFrames: () => [...frames.values()],
    failNextWrite: (message = "storage unavailable") => { writeError = message; },
    item: (id) => [...window.document.querySelectorAll("#items .item")].find(element => element.dataset.id === id) ?? null,
    cached: () => JSON.parse(memory.get("laterOnPanelCache") || "null"),
    count: () => window.document.querySelectorAll("#items .item").length,
    click: (element) => {
      assert.ok(element, "点击目标必须存在");
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  };
}

module.exports = { createPanelPage, makeItem, makeStore };
