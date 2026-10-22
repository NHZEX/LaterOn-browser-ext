const assert = require("node:assert/strict");
const vm = require("node:vm");
const { DEFAULTS, KEY, resolveSettings, resolveTheme } = require("../src/settings/shared.ts");
const source = require("./helpers/read-runtime.cjs")("theme.js");
const tick = () => new Promise(resolve => setImmediate(resolve));

function createStorage(initial) {
  const store = { [KEY]: structuredClone(initial) };
  const listeners = [];
  const chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: structuredClone(store[key]) }; },
        async set(patch) {
          const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) =>
            [key, { oldValue: structuredClone(store[key]), newValue: structuredClone(value) }]));
          Object.assign(store, structuredClone(patch));
          listeners.forEach(listener => listener(changes, "local"));
        }
      },
      onChanged: { addListener(listener) { listeners.push(listener); } }
    }
  };
  return { chrome, store, listeners };
}

function createPage(chrome, mediaAPI = "addEventListener") {
  let dark = true;
  const listeners = [];
  const media = {
    get matches() { return dark; },
    [mediaAPI](...args) { listeners.push(args.at(-1)); }
  };
  const page = vm.createContext({ chrome, document: { documentElement: { dataset: {} } } });
  page.window = page;
  if (mediaAPI) page.matchMedia = query => {
    assert.equal(query, "(prefers-color-scheme: dark)");
    return media;
  };
  vm.runInContext(source, page);
  return {
    page,
    settings: page.LaterOnSettings,
    theme: () => page.document.documentElement.dataset.theme,
    changeSystem(value) { dark = value; listeners.forEach(listener => listener()); }
  };
}

(async () => {
  assert.equal(globalThis.LaterOnSettings, undefined, "Importing pure settings rules does not initialize a page");
  assert.deepEqual(resolveSettings(), DEFAULTS);
  assert.equal(resolveSettings({ autoCleanDays: 90 }).autoCleanEnabled, true, "Legacy settings keep automatic cleanup enabled");
  assert.equal(resolveSettings({ autoCleanEnabled: false }).autoCleanEnabled, false);
  const legacy = { askFolderOnSingle: true, libraryView: "boards", sidebarWidth: 320 };
  const before = structuredClone(legacy);
  assert.equal(resolveSettings(legacy).askFolderOnSingle, false);
  assert.equal(resolveSettings({ ...legacy, askFolderOnSingleOptIn: true }).askFolderOnSingle, true);
  assert.deepEqual(legacy, before, "Resolving settings does not mutate the stored object");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");

  const { chrome, store, listeners } = createStorage({ ...legacy, theme: "system", defaultSort: "custom" });
  const first = createPage(chrome);
  const second = createPage(chrome, "addListener");
  await tick();
  assert.equal(first.theme(), "dark");
  assert.equal(second.theme(), "dark", "The legacy media listener remains supported");
  assert.equal(first.settings.KEY, KEY);
  assert.equal((await first.settings.get()).askFolderOnSingle, false);
  assert.equal(store[KEY].askFolderOnSingle, true, "Reading legacy settings does not write a migration");
  await first.settings.set({ language: "en" });
  assert.equal(store[KEY].libraryView, "boards");
  assert.equal(store[KEY].sidebarWidth, 320);
  assert.equal(store[KEY].defaultSort, "custom");
  assert.equal(store[KEY].language, "en");
  assert.equal(store[KEY].askFolderOnSingle, false);
  assert.equal(store[KEY].askFolderOnSingleOptIn, false);
  await first.settings.set({ askFolderOnSingle: true });
  assert.equal(store[KEY].askFolderOnSingleOptIn, true);
  assert.equal((await second.settings.get()).askFolderOnSingle, true);
  await second.settings.set({ askFolderOnSingle: false });
  assert.equal(store[KEY].askFolderOnSingleOptIn, true, "Explicitly disabling single-save also records opt-in");

  await first.settings.set({ autoCleanDays: 90, autoCleanEnabled: false });
  await second.settings.set({ theme: "light" });
  assert.equal((await first.settings.get()).autoCleanEnabled, false, "Other preferences preserve disabled cleanup");
  await first.settings.set({ autoCleanEnabled: true });
  assert.equal(store[KEY].autoCleanDays, 90, "Re-enabling retains the previous day limit");

  const updates = [];
  first.settings.watch((current, previous) => updates.push({ current, previous }));
  const changed = { newValue: { theme: "light", askFolderOnSingle: true }, oldValue: { theme: "dark" } };
  listeners.forEach(listener => listener({ [KEY]: changed }, "sync"));
  listeners.forEach(listener => listener({ unrelated: changed }, "local"));
  assert.equal(updates.length, 0);
  await chrome.storage.local.set({ [KEY]: changed.newValue });
  assert.equal(first.theme(), "light");
  assert.equal(second.theme(), "light", "Storage notifications update both pages immediately");
  assert.equal(updates[0].current.askFolderOnSingle, true, "Watch preserves the historical raw change payload");
  assert.equal(updates[0].current.autoCleanDays, 30);
  assert.equal(updates[0].current.autoCleanEnabled, true);
  assert.equal(updates[0].previous.theme, "light");
  assert.equal((await first.settings.get()).askFolderOnSingle, false, "Reads still apply the legacy opt-in rule");
  for (const raw of [null, ["legacy"], "old"]) {
    listeners.forEach(listener => listener({ [KEY]: { newValue: raw } }, "local"));
    assert.deepEqual(JSON.parse(JSON.stringify(updates.at(-1).current)), { ...DEFAULTS, ...(raw || {}) });
  }

  await first.settings.set({ theme: "system" });
  first.changeSystem(false);
  second.changeSystem(false);
  await tick();
  assert.equal(first.theme(), "light");
  assert.equal(second.theme(), "light");
  await first.settings.set({ theme: "dark" });
  first.changeSystem(false);
  await tick();
  assert.equal(first.theme(), "dark", "An explicit theme ignores system changes");
  const withoutMedia = createPage(chrome, null);
  await tick();
  withoutMedia.settings.applyTheme("system");
  assert.equal(withoutMedia.theme(), "light", "No media API falls back to the light theme");
  listeners.forEach(listener => listener({ [KEY]: { oldValue: store[KEY] } }, "local"));
  assert.equal(first.theme(), "light", "Removing settings restores the default theme");

  chrome.storage.local.set = async () => { throw Error("quota exceeded"); };
  await assert.rejects(first.settings.set({ theme: "light" }), /quota exceeded/);
  chrome.storage.local.get = async () => { throw Error("storage unavailable"); };
  await assert.rejects(first.settings.get(), /storage unavailable/);
  console.log("PASS settings defaults, legacy opt-in, extra fields, change notifications, system themes and storage errors");
})().catch(error => { console.error(error); process.exitCode = 1; });
