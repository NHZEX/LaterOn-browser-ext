const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { buildSync } = require("esbuild");
const { resolve } = require("node:path");
const FakeTimers = require("@sinonjs/fake-timers");
const code = buildSync({ stdin: { loader: "ts", resolveDir: resolve(__dirname, ".."), contents:
  "import { usePanelCache } from './src/sidepanel/usePanelCache'; globalThis.makeCache = usePanelCache;" },
  bundle: true, write: false, platform: "browser", format: "iife" }).outputFiles[0].text;
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(collection, initial = null) {
  const memory = new Map(initial === null ? [] : [["laterOnPanelCache", JSON.stringify(initial)]]);
  const clock = FakeTimers.createClock();
  const context = vm.createContext({ setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock), localStorage: {
    getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key)
  } });
  vm.runInContext(code, context);
  return { cache: context.makeCache(() => collection), clock, memory };
}
test("preview stores one shared image for twelve records, and excludes images outside the preview", () => {
  const hash = "a".repeat(64), unused = "b".repeat(64), image = "data:image/png;base64,AAAA";
  const collection = { items: Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, savedAt: i, favicon: `icon://${hash}` })),
    icons: { [hash]: image, [unused]: "data:image/png;base64,BBBB" }, archivedProjectIds: new Set() };
  const before = clone(collection.items);
  const f = fixture(collection);
  f.cache.schedule(); f.clock.tick(300);
  const persisted = JSON.parse(f.memory.get("laterOnPanelCache"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.items.length, 12);
  assert.deepEqual(persisted.items.map(item => item.id), Array.from({ length: 12 }, (_, i) => `${19 - i}`));
  assert.deepEqual(persisted.icons, { [hash]: image });
  assert.deepEqual(clone(f.cache.read()), { items: persisted.items, icons: persisted.icons });
  assert.deepEqual(collection.items, before);
  f.cache.dispose();
});
test("obsolete preview versions are discarded, malformed image entries cannot resolve, and oversize previews are removed", () => {
  const empty = { items: [], icons: {}, archivedProjectIds: new Set() };
  const old = fixture(empty, [{ id: "legacy", favicon: "data:image/png;base64,AAAA" }]);
  assert.equal(old.cache.read(), null);
  const invalid = fixture(empty, { version: 2, items: [{ id: "missing", favicon: `icon://${"a".repeat(64)}` }], icons: { ["a".repeat(64)]: 7 } });
  assert.deepEqual(clone(invalid.cache.read()).icons, {});
  const large = fixture({ ...empty, items: [{ id: "huge", description: "x".repeat(2000000) }] }, { version: 2, items: [], icons: {} });
  large.cache.schedule(); large.clock.tick(300);
  assert.equal(large.memory.has("laterOnPanelCache"), false);
});
