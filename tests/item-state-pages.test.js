const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");
const read = require("./helpers/read-runtime.cjs");
const installStorage = require("./helpers/item-mutation");
const clone = value => JSON.parse(JSON.stringify(value));
const event = () => ({ addListener() {} });
async function until(condition, message) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), message);
}
const fixtureItem = (id, extra) => ({ id, title: id, url: `https://example.com/${id}`, description: "Summary", image: "", favicon: "",
  source: "example.com", projectId: null, savedAt: 1, ...extra });

function boot(page, store, { failMigration = false, delayStorage = false, cache = null } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  virtualConsole.on("error", error => errors.push(String(error)));
  const dom = new JSDOM(read(`${page}.html`), { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole,
    url: `chrome-extension://lateron/${page}.html?from=sidepanel&project=unfiled` });
  const { window } = dom;
  window.scrollTo = () => {};
  const memory = new Map(cache ? [["laterOnPanelCache", JSON.stringify(cache)]] : []);
  Object.defineProperty(window, "localStorage", { value: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key)
  } });
  let releaseStorage;
  const storageReady = delayStorage ? new Promise(resolve => { releaseStorage = resolve; }) : Promise.resolve();
  const listeners = [];
  const writes = [];
  let failedWrites = 0;
  window.chrome = {
    storage: { local: {
      async get(keys) {
        await storageReady;
        return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]])));
      },
      async set(patch) {
        if (failMigration && patch.laterOnItems) { failedWrites++; throw Error("fixture migration write failure"); }
        writes.push(clone(patch));
        Object.assign(store, clone(patch));
        // No broadcast: successful writes must update the page from the command response.
      }
    }, onChanged: { addListener: listener => listeners.push(listener) } },
    tabs: { query: async () => [{ id: 7, windowId: 3, url: "https://example.com/current" }],
      getCurrent: async () => ({ id: 7, windowId: 3 }), create: async () => ({}), update: async () => ({}),
      onActivated: event(), onUpdated: event() },
    runtime: { getURL: name => `chrome-extension://lateron/${name}`, sendMessage: async () => ({ ok: false }), onMessage: event() },
    windows: { getCurrent: async () => ({ id: 3 }) }, sidePanel: { open: async () => ({}) }
  };
  window.eval(read("i18n.js"));
  installStorage(window);
  window.eval(read(`${page}.js`));
  const card = id => window.document.querySelector(`${page === "library" ? ".card" : ".item"}[data-id="${id}"]`);
  const broadcast = () => listeners.forEach(listener => listener({ laterOnItems: { newValue: clone(store.laterOnItems) } }, "local"));
  return { window, card, writes, errors, broadcast, memory, releaseStorage, failedWrites: () => failedWrites, close: () => window.close() };
}

async function checkPage(page) {
  const store = {
    laterOnItems: [null, fixtureItem("legacy", { read: true, image: "data:image/png;base64,AAAA" }), fixtureItem("known", { status: "done", doneAt: 123 }),
      fixtureItem("reading", { status: "reading", read: true, doneAt: 456 }), fixtureItem("unread", { read: false })],
    laterOnCovers: { other: "data:image/png;base64,BBBB" },
    laterOnProjects: [], laterOnSettings: {}, laterOnActiveProject: "unfiled", laterOnFilter: "all", laterOnFilterChosen: true
  };
  const before = clone(store.laterOnItems);
  const failed = boot(page, store, { failMigration: true });
  try {
    await until(() => failed.card("legacy") && failed.failedWrites() === 1, `${page}: failed migration still renders legacy records`);
    assert.ok(failed.card("legacy").classList.contains("is-read"));
    assert.ok(failed.card("known").classList.contains("is-read"));
    assert.ok(failed.card("reading").classList.contains("is-reading"));
    assert.ok(!failed.card("unread").classList.contains("is-read"));
    assert.deepEqual(store.laterOnItems, before, "Failed initialization never persists a fabricated display timestamp");
    assert.deepEqual(store.laterOnCovers, { other: "data:image/png;base64,BBBB" }, "Failed cover migration also preserves associated data");
    // Whole-page adapter executes the same pure rules even when the migration cannot commit.
    const normalized = failed.window.normalizeItems(clone(before));
    assert.equal(normalized.find(item => item.id === "legacy").doneAt, null);
    assert.equal(normalized.find(item => item.id === "known").doneAt, 123);
    assert.deepEqual(failed.errors, []);
  } finally { failed.close(); }

  const retryStarted = Date.now();
  const ready = boot(page, store);
  let completedAt;
  try {
    await until(() => ready.card("legacy") && store.laterOnItems[0]?.doneAt >= retryStarted, `${page}: reopening retries the real queued migration`);
    completedAt = store.laterOnItems[0].doneAt;
    assert.ok(completedAt <= Date.now());
    assert.equal(store.laterOnItems[0].image, "local://legacy");
    assert.deepEqual(store.laterOnCovers, { legacy: "data:image/png;base64,AAAA", other: "data:image/png;base64,BBBB" });
    assert.equal(store.laterOnItems[1].doneAt, 123);
    assert.equal(store.laterOnItems[2].doneAt, null);
    const find = id => store.laterOnItems.find(item => item.id === id);
    ready.card("reading").querySelector(".read-toggle").click();
    await until(() => find("reading").status === "done" && ready.card("reading").classList.contains("is-read"), "Manual completion updates storage and UI without broadcasts");
    assert.equal(find("reading").read, true);
    assert.ok(find("reading").doneAt >= retryStarted);
    ready.card("reading").querySelector(".read-toggle").click();
    await until(() => find("reading").status === "unread" && !ready.card("reading").classList.contains("is-read"), "Unmarking clears completion");
    assert.equal(find("reading").doneAt, null);
    assert.equal(find("reading").read, false);
    find("unread").status = "done";
    find("unread").doneAt = 789;
    ready.broadcast();
    await until(() => ready.card("unread").classList.contains("is-read"), "External completion broadcasts update the page");
    assert.equal(ready.window.normalizeItems(clone(store.laterOnItems)).find(item => item.id === "unread").doneAt, 789);
    assert.deepEqual(ready.errors, []);
  } finally { ready.close(); }

  const reopened = boot(page, store);
  try {
    await until(() => reopened.card("legacy"), `${page}: migrated records reopen`);
    assert.equal(store.laterOnItems[0].doneAt, completedAt);
    assert.equal(reopened.writes.filter(patch => patch.laterOnItems).length, 0, "Reopening cannot restart the grace period");
    assert.deepEqual(reopened.errors, []);
  } finally { reopened.close(); }
}

async function checkCachedState() {
  const cached = [fixtureItem("cached", { read: true }), fixtureItem("cached-unread", { read: false })];
  const store = { laterOnItems: clone(cached), laterOnProjects: [], laterOnSettings: {}, laterOnFilter: "all", laterOnFilterChosen: true };
  const panel = boot("sidepanel", store, { delayStorage: true, cache: cached });
  try {
    await until(() => panel.card("cached-unread"), "A legacy cache renders before storage returns");
    panel.window.document.querySelector('.filter[data-filter="all"]').click();
    await until(() => panel.card("cached"), "The cached completed record follows the selected filter");
    assert.ok(panel.card("cached").classList.contains("is-read"));
    const normalized = panel.window.normalizeItems(cached);
    assert.equal(normalized[0].doneAt, null, "Cache display never starts the cleanup clock");
    assert.equal(store.laterOnItems[0].doneAt, undefined);
    panel.releaseStorage();
    await until(() => store.laterOnItems[0].doneAt > 0, "Storage migration later supplies a persisted timestamp");
    assert.deepEqual(panel.errors, []);
  } finally { panel.close(); }
}

(async () => {
  await checkPage("library");
  await checkPage("sidepanel");
  await checkCachedState();
  console.log("PASS both pages: migration failure/reopen, stable dates, manual status, broadcasts and cached startup");
})().catch(error => { console.error(error); process.exitCode = 1; });
