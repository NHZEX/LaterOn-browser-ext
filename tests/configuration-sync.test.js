const assert = require("node:assert/strict");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const readRuntime = require("./helpers/read-runtime.cjs");
const { createWorkerContext } = require("./helpers/worker-context.cjs");

const settingsKey = "laterOnSettings";
const keys = { theme: "stayside.preference.theme", language: "stayside.preference.language", defaultSort: "stayside.preference.defaultSort" };

function browserSync() {
  const values = {};
  const writes = [];
  const notify = new Set();
  function apply(patch) {
    const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
      JSON.stringify(values[key]) !== JSON.stringify(value)).map(([key, value]) => [key, { oldValue: values[key], newValue: value }]));
    Object.assign(values, structuredClone(patch));
    for (const send of notify) send(changes, "sync");
  }
  return { values, writes, notify, apply };
}

function profile(cloud, preferences = {}) {
  const data = { laterOnCleanupV165: true, [settingsKey]: { autoCleanEnabled: false, ...preferences } };
  const listeners = [];
  const changes = [];
  const emptyEvent = { addListener() {} };
  const emit = (patch, area) => changes.forEach(listener => listener(structuredClone(patch), area));
  const get = (items, request) => structuredClone(Object.fromEntries((Array.isArray(request) ? request : [request])
    .filter(key => Object.hasOwn(items, key)).map(key => [key, items[key]])));
  function localArea(items, area) {
    return {
      async get(request) { return get(items, request); },
      async set(patch) {
        const changed = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: items[key], newValue: value }]));
        Object.assign(items, structuredClone(patch));
        emit(changed, area);
      },
      async remove(key) { delete items[key]; }
    };
  }
  let rejectReads = false;
  let rejectWrites = false;
  const alarms = new Set();
  const requests = [];
  const chrome = {
    storage: { local: localArea(data, "local"), session: localArea({}, "session"),
      onChanged: { addListener(fn) { changes.push(fn); } },
      sync: {
        async get(request) {
          if (rejectReads) throw new Error("sync read unavailable");
          return get(cloud.values, request);
        },
        async set(patch) {
          if (rejectWrites) throw new Error("sync write unavailable");
          cloud.writes.push(structuredClone(patch));
          cloud.apply(patch);
        }
      }
    },
    alarms: { async create(name) { alarms.add(name); }, async clear(name) { alarms.delete(name); }, onAlarm: emptyEvent },
    contextMenus: { removeAll(done) { done?.(); }, create() {}, onClicked: emptyEvent }, commands: { onCommand: emptyEvent },
    runtime: { onStartup: emptyEvent, onInstalled: emptyEvent, onMessage: { addListener(fn) { listeners.push(fn); } },
      getManifest: () => ({ version: "1.80.0" }), getURL: name => `chrome-extension://fixture/${name}` },
    tabs: { onUpdated: emptyEvent, onRemoved: emptyEvent, onCreated: emptyEvent, onActivated: emptyEvent },
    action: {}, sidePanel: { setPanelBehavior() {} }
  };
  cloud.notify.add(emit);
  const context = createWorkerContext({ chrome, URL, TextEncoder, TextDecoder, crypto: webcrypto, queueMicrotask,
    AbortSignal, atob, btoa, console, setTimeout, clearTimeout,
    async fetch(url, request) {
      requests.push([url, request.headers.Authorization]);
      if (request.headers.Authorization !== "Basic " + btoa("fixture:new-secret")) return new Response(null, { status: 401 });
      return new Response(`<multistatus xmlns="DAV:"><response><href>${url}</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response></multistatus>`, { status: 207 });
    }
  });
  vm.runInContext(readRuntime("background-test-api.js"), context);
  const request = (type, action, fields) => new Promise(resolve => {
    for (const listener of listeners) {
      if (listener({ type, action, ...fields }, { url: "chrome-extension://fixture/settings.html", tab: { id: 1 } }, resolve)) return;
    }
    throw new Error(`Missing handler for ${type}`);
  });
  return {
    data, alarms, requests,
    configure: (action, fields) => request("CONFIGURATION_SYNC", action, fields),
    webdav: (action, fields) => request("WEBDAV_BACKUP", action, fields),
    async change(patch) { await chrome.storage.local.set({ [settingsKey]: { ...data[settingsKey], ...patch } }); },
    denyReads(value) { rejectReads = value; }, denyWrites(value) { rejectWrites = value; }
  };
}

(async () => {
  const cloud = browserSync();
  const first = profile(cloud, { theme: "dark", autoCleanDays: 90 });
  assert.equal((await first.configure("status")).status.enabled, false);
  await first.change({ language: "en", defaultSort: "source", askFolderOnBatch: false });
  assert.deepEqual(cloud.values, {});
  assert.equal((await first.configure("enable")).status.enabled, true);
  assert.deepEqual(cloud.values, { [keys.theme]: "dark", [keys.language]: "en", [keys.defaultSort]: "source" });

  const second = profile(cloud);
  second.denyReads(true);
  assert.equal((await second.configure("enable")).ok, false);
  assert.equal((await second.configure("status")).status.enabled, false);
  second.denyReads(false);
  const { preview } = await second.configure("enable");
  assert.deepEqual(structuredClone(preview.differences), [
    { key: "theme", local: "light", synced: "dark" },
    { key: "language", local: "zh-CN", synced: "en" },
    { key: "defaultSort", local: "newest", synced: "source" }
  ]);
  assert.equal(second.data[settingsKey].theme, undefined);
  await second.configure("enable", { choice: "synced", revision: preview.revision });
  assert.equal(second.data[settingsKey].theme, "dark");
  assert.equal(cloud.writes.length, 1, "Adopting the synchronized settings does not write them back");
  await Promise.all([first.change({ theme: "light" }), second.change({ defaultSort: "oldest" })]);
  await Promise.all([first.configure("status"), second.configure("status")]);
  await Promise.all([first.configure("status"), second.configure("status")]);
  assert.deepEqual(cloud.values, { [keys.theme]: "light", [keys.language]: "en", [keys.defaultSort]: "oldest" });
  assert.equal(first.data[settingsKey].defaultSort, "oldest");
  assert.equal(second.data[settingsKey].theme, "light");
  assert.equal(cloud.writes.length, 3, "Independent changes are published once per field");

  first.denyWrites(true);
  await first.change({ theme: "system" });
  assert.deepEqual(structuredClone((await first.configure("status")).status.failed), ["theme"]);
  assert.equal(first.data[settingsKey].theme, "system");
  await first.change({ theme: "dark" });
  await first.configure("status");
  first.denyWrites(false);
  assert.equal((await first.configure("retry")).status.failed.length, 0);
  assert.deepEqual(cloud.writes.at(-1), { [keys.theme]: "dark" });
  await second.configure("disable");
  await second.change({ theme: "system" });
  cloud.apply({ [keys.theme]: "light" });
  await first.configure("status");
  await second.configure("status");
  assert.equal(first.data[settingsKey].theme, "light");
  assert.equal(second.data[settingsKey].theme, "system");
  assert.equal(cloud.values[keys.theme], "light");

  const localChoice = (await second.configure("enable")).preview;
  cloud.apply({ [keys.theme]: "dark" });
  const fresh = await second.configure("enable", { choice: "local", revision: localChoice.revision });
  assert.equal(fresh.status.enabled, false);
  assert.equal(fresh.preview.differences[0].synced, "dark");
  await second.configure("enable", { choice: "local", revision: fresh.preview.revision });
  await first.configure("status");
  assert.equal(cloud.values[keys.theme], "system");
  assert.equal(first.data[settingsKey].theme, "system");
  await Promise.all([first.change({ theme: "dark" }), second.change({ theme: "light" })]);
  await Promise.all([first.configure("status"), second.configure("status")]);
  await Promise.all([first.configure("status"), second.configure("status")]);
  assert.equal(first.data[settingsKey].theme, cloud.values[keys.theme]);
  assert.equal(second.data[settingsKey].theme, cloud.values[keys.theme]);

  const presetKey = "stayside.webdav-preset";
  const options = { endpoint: "https://one.example.test/dav/", directory: "StaySide", username: "fixture",
    intervalHours: 24, includeImages: false, budgetMiB: 192, automatic: true };
  assert((await first.webdav("save", { options, password: "local-secret" })).ok);
  assert.equal(cloud.values[presetKey], undefined);
  await first.configure("preset", { enabled: true });
  assert.deepEqual(cloud.values[presetKey], { endpoint: options.endpoint, directory: "StaySide", username: "fixture",
    intervalHours: 24, includeImages: false });

  const preset = { ...cloud.values[presetKey], endpoint: "https://two.example.test/dav/", intervalHours: 48, includeImages: true };
  cloud.apply({ [presetKey]: { ...preset, password: "ignored", automatic: true } });
  const received = (await first.configure("status")).status.preset;
  assert.deepEqual(structuredClone(received), preset);
  assert.deepEqual(first.requests, []);
  const alarm = "stayside-webdav-backup";
  assert(first.alarms.has(alarm));
  assert.equal((await first.webdav("status")).status.options.endpoint, options.endpoint);

  assert.equal((await first.webdav("applyPreset", { preset, password: "new-secret" })).ok, false);
  assert.equal((await first.webdav("testPreset", { preset, password: "" })).ok, false);
  assert.deepEqual(first.requests, [], "A different endpoint cannot reuse the current password");
  assert.equal((await first.webdav("testPreset", { preset, password: "invalid" })).ok, false);
  const tested = await first.webdav("testPreset", { preset, password: "new-secret" });
  assert(tested.ok);
  assert.deepEqual(first.requests.at(-1), [preset.endpoint, "Basic " + btoa("fixture:new-secret")]);
  assert(first.alarms.has(alarm));
  assert.equal((await first.webdav("status")).status.options.endpoint, options.endpoint);
  assert.equal((await first.webdav("applyPreset", {
    preset: { ...preset, directory: "Other" }, password: "new-secret", token: tested.token
  })).ok, false);
  const newer = { ...preset, directory: "Newer" };
  cloud.apply({ [presetKey]: newer });
  assert.equal((await first.configure("status")).status.preset.directory, "Newer");
  const applied = await first.webdav("applyPreset", { preset, password: "new-secret", token: tested.token });
  assert(applied.ok);
  assert.deepEqual(structuredClone(applied.status.options), { ...preset, automatic: false, budgetMiB: 192 });
  assert(!first.alarms.has(alarm));
  assert.deepEqual(cloud.values[presetKey], newer, "Applying a tested draft does not publish it again");

  const next = { ...applied.status.options, automatic: true, budgetMiB: 65 };
  first.denyWrites(true);
  assert((await first.webdav("save", { options: next, password: "" })).ok);
  assert.deepEqual(structuredClone((await first.configure("status")).status.failed), ["preset"]);
  assert.equal((await first.webdav("status")).status.options.budgetMiB, 65);
  first.denyWrites(false);
  assert.equal((await first.configure("retry")).status.failed.length, 0);
  assert.deepEqual(cloud.writes.at(-1), { [presetKey]: preset });
  assert.deepEqual(cloud.values[presetKey], preset);
  const intervalOnly = { ...preset, intervalHours: 72 };
  cloud.apply({ [presetKey]: intervalOnly });
  const retested = await first.webdav("testPreset", { preset: intervalOnly, password: "" });
  assert(retested.ok);
  const sameTarget = await first.webdav("applyPreset", { preset: intervalOnly, password: "", token: retested.token });
  assert(sameTarget.ok);
  assert.equal(sameTarget.status.options.automatic, true);
  assert.equal(sameTarget.status.options.budgetMiB, 65);
  assert(first.alarms.has(alarm));
})().catch(error => { console.error(error); process.exitCode = 1; });
