const assert = require("node:assert/strict");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const rules = require("../src/collection/item-state.ts");
const read = require("./helpers/read-runtime.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

assert.equal(globalThis.LaterOnItemState, undefined, "Pure imports do not register a browser global");
const context = vm.createContext({});
vm.runInContext(read("item-state.js"), context);
const cases = [
  [{}, { status: "unread", doneAt: null }],
  [{ read: false }, { status: "unread", doneAt: null }],
  [{ read: true }, { status: "done", doneAt: null }],
  [{ status: "reading", read: true, doneAt: 123 }, { status: "reading", doneAt: null }],
  [{ status: "unread", read: true, doneAt: 123 }, { status: "unread", doneAt: null }],
  [{ status: "done", read: false, doneAt: 123 }, { status: "done", doneAt: 123 }],
  [{ status: "done", doneAt: "456" }, { status: "done", doneAt: 456 }],
  ...[undefined, null, 0, "", "invalid"].map(doneAt => [{ status: "done", doneAt }, { status: "done", doneAt: null }])
];
for (const api of [rules, context.LaterOnItemState]) {
  for (const [input, expected] of cases) {
    Object.freeze(input);
    assert.deepEqual(clone(api.normalizeItemState(input)), expected);
  }
  const item = Object.freeze({ id: "a", read: true, image: "local://a", extra: "retained" });
  const list = Object.freeze([null, item, undefined]);
  assert.deepEqual(clone(api.normalizeItems(list)), [{ ...item, status: "done", doneAt: null }]);
  assert.equal(item.status, undefined, "Normalization leaves legacy input intact");
  assert.deepEqual(clone(api.normalizeItems(api.normalizeItems(list))), clone(api.normalizeItems(list)), "Display normalization is idempotent");
  for (const absent of [null, undefined, []]) assert.deepEqual(clone(api.normalizeItems(absent)), []);
  assert.equal(api.nextStatus("unread"), "done");
  assert.equal(api.nextStatus("reading"), "done");
  assert.equal(api.nextStatus("done"), "unread");
  for (const input of [[null], [item], [{ id: "b", status: "done", doneAt: 0 }], [{ id: "b", image: "data:image/png;base64,AAAA" }]]) {
    assert.equal(api.needsLegacyMigration(input), true);
  }
  for (const input of [undefined, null, [], [{ id: "b", status: "done", doneAt: 123 }], [{ id: "b", status: "reading", read: true }]]) {
    assert.equal(api.needsLegacyMigration(input), false);
  }
}

// Execute the real queued coordinator and cleanup with an explicit clock and copied storage.
const DAY = 86_400_000;
let now = 1_800_000_000_000;
class FixtureDate extends Date { static now() { return now; } }
const event = () => ({ addListener() {} });
const store = { laterOnItems: [], laterOnSettings: { autoCleanEnabled: false }, laterOnCleanupV165: true };
let failWrite = false;
let writes = 0;
const chrome = {
  storage: { local: {
    async get(keys) {
      return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]])));
    },
    async set(patch) {
      if (failWrite) throw Error("fixture write failure");
      writes++;
      Object.assign(store, clone(patch));
    }
  }, onChanged: event() },
  alarms: { create() {}, onAlarm: event() }, commands: { onCommand: event() },
  contextMenus: { removeAll(callback) { callback?.(); }, create() {}, onClicked: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: name => `chrome-extension://fixture/${name}` },
  tabs: { onUpdated: event(), onRemoved: event(), onCreated: event(), onActivated: event() },
  action: {}, sidePanel: { setPanelBehavior() {} }
};
const worker = vm.createContext({ chrome, Date: FixtureDate, console, URL, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval });
worker.importScripts = (...names) => names.forEach(name => vm.runInContext(read(name), worker, { filename: name }));
vm.runInContext(read("background-test-api.js"), worker);
const execute = fields => worker.backgroundTest.execute(fields);
const migrate = () => execute({ action: "migrateLegacyData" });
const update = (id, patch) => execute({ action: "mutateItems", operation: "update", ids: [id], patch });

(async () => {
  // Drain startup cleanup before preparing test records.
  await worker.backgroundTest.purgeExpiredItems();
  const originalTime = now - 60 * DAY;
  store.laterOnItems = [null, { id: "legacy", read: true, savedAt: 1, image: "data:image/png;base64,AAAA" },
    { id: "existing", status: "done", doneAt: originalTime }, { id: "reading", status: "reading", read: true, doneAt: 123 }];
  store.laterOnCovers = { other: "data:image/png;base64,BBBB" };
  const before = clone(store);
  failWrite = true;
  await assert.rejects(migrate(), /fixture write failure/);
  assert.deepEqual(store, before, "A failed migration changes neither timestamps nor cover data");
  now += DAY;
  failWrite = false;
  await Promise.all([migrate(), migrate()]);
  const migratedTime = now;
  assert.equal(store.laterOnItems[0].doneAt, migratedTime, "The successful transaction starts the legacy grace period");
  assert.equal(store.laterOnItems[0].image, "local://legacy");
  assert.equal(store.laterOnCovers.legacy, before.laterOnItems[1].image);
  assert.equal(store.laterOnCovers.other, before.laterOnCovers.other);
  assert.equal(store.laterOnItems[1].doneAt, originalTime, "An existing completion date is preserved");
  assert.equal(store.laterOnItems[2].doneAt, null, "Reading status wins over the legacy boolean");
  const after = clone(store);
  const writesAfterMigration = writes;
  now += DAY;
  await migrate();
  assert.deepEqual(store, after);
  assert.equal(writes, writesAfterMigration, "Repeat migration neither writes nor resets the cleanup clock");
  await update("legacy", { status: "done" });
  assert.equal(store.laterOnItems[0].doneAt, migratedTime, "Repeat completion keeps its date");
  await update("reading", { status: "done" });
  assert.equal(store.laterOnItems[2].doneAt, now, "Manual completion records the worker time");
  await update("reading", { status: "unread" });
  assert.equal(store.laterOnItems[2].doneAt, null);
  assert.equal(store.laterOnItems[2].read, false);
  await update("reading", { status: "reading" });
  assert.equal(store.laterOnItems[2].doneAt, null);

  store.laterOnItems.push({ id: "unmigrated", read: true, savedAt: 1 });
  store.laterOnSettings = { autoCleanDays: 30 };
  await worker.backgroundTest.purgeExpiredItems();
  assert.deepEqual(store.laterOnItems.map(item => item.id), ["legacy", "reading", "unmigrated"], "Expired known dates are removed; migrated grace periods and unknown dates survive");
  now = migratedTime + 31 * DAY;
  await worker.backgroundTest.purgeExpiredItems();
  assert.deepEqual(store.laterOnItems.map(item => item.id), ["reading", "unmigrated"]);
  assert.equal(store.laterOnCovers.legacy, undefined);
  assert.equal(store.laterOnCovers.other, before.laterOnCovers.other);
  console.log("PASS shared item state, queued migration, failure/retry, stable timestamps and real cleanup");
})().catch(error => { console.error(error); process.exitCode = 1; });
