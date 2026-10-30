const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");
const { buildSync } = require("esbuild");
const { resolve } = require("node:path");
const { internIcons, resolveFavicon } = require("./helpers/load-module.cjs")("src/storage/icons.ts");
const core = require("./helpers/load-module.cjs")("src/backup/core.ts");
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash("sha256").update(value).digest("hex");
const image = suffix => `data:image/png;base64,${Buffer.from(`test icon ${suffix}`).toString("base64")}`;
const item = (id, favicon, fields = {}) => ({ id, url: `https://same.test/${id}`, title: id, description: "Summary", image: "", favicon,
  savedAt: 100, projectId: null, status: "unread", read: false, doneAt: null, ...fields });
const source = buildSync({ stdin: { loader: "ts", resolveDir: resolve(__dirname, ".."), contents: `
  import * as store from './src/storage/coordinator';
  import * as collection from './src/background/collection';
  import { runBatchSave } from './src/background/save-workflow';
  import { purgeExpiredItems } from './src/background/maintenance';
  import { registerBackup } from './src/backup/background';
  registerBackup();
  globalThis.iconTest = { ...store, ...collection, runBatchSave, purgeExpiredItems };
` }, bundle: true, write: false, platform: "browser", format: "iife" }).outputFiles[0].text;

function fixture(initial = {}, crypto = webcrypto) {
  const state = { laterOnItems: [], laterOnProjects: [], laterOnSettings: { autoCleanEnabled: false }, ...clone(initial) };
  const listeners = [], writes = [];
  let fail = false;
  const local = {
    async get(keys) { return clone(Object.fromEntries((keys === null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys])
      .filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]))); },
    async set(patch) {
      if (fail) { fail = false; throw Error("disk full"); }
      writes.push(clone(patch)); Object.assign(state, clone(patch));
    }
  };
  const chrome = { storage: { local }, runtime: { getURL: name => `chrome-extension://fixture/${name}`,
    getManifest: () => ({ version: "1.71.0" }), onMessage: { addListener: fn => listeners.push(fn) } }, action: {} };
  const context = vm.createContext({ chrome, crypto, TextEncoder, URL, console, clearTimeout,
    setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; },
    fetch: async () => ({ ok: false }) });
  vm.runInContext(source, context);
  return { state, writes, api: context.iconTest, failNext: () => { fail = true; },
    send: message => new Promise((resolve, reject) => {
      if (!listeners.some(fn => fn(message, {}, resolve) === true)) reject(Error("Unhandled message"));
    }) };
}

test("14 inline occurrences become four exact-content images, retaining every other field", async () => {
  const icons = [image("a"), image("b"), image("c"), image("d")];
  const items = [9, 2, 1, 2].flatMap((count, group) => Array.from({ length: count }, (_, i) => item(`${group}-${i}`, icons[group])));
  items.push(item("remote", "https://same.test/icon.ico"), item("empty", ""));
  const before = clone(items);
  const result = await internIcons(items, {});
  assert.equal(Object.keys(result.icons).length, 4);
  assert.equal(new Set(result.items.slice(0, 14).map(value => value.favicon)).size, 4);
  assert.deepEqual(result.items.map(value => ({ ...value, favicon: resolveFavicon(value.favicon, result.icons) })), before);
  assert.deepEqual(items, before);
  assert.deepEqual(await internIcons(result.items, result.icons), result);
  assert.equal(resolveFavicon(`icon://${"0".repeat(64)}`, {}), "");
  assert.equal(resolveFavicon("icon://invalid", {}), "");
});

test("queued migration is idempotent, preserves failure data and retries; stored refs survive a worker restart", async () => {
  const f = fixture({ laterOnItems: [item("one", image("a")), item("two", image("a"))] });
  const original = clone(f.state);
  f.failNext();
  await assert.rejects(f.api.migrateIcons(), /disk full/);
  assert.deepEqual(f.state, original);
  await f.api.migrateIcons();
  assert.equal(f.writes.length, 1);
  assert.ok(f.writes[0].laterOnItems && f.writes[0].laterOnIcons, "References and image content use one write");
  assert.equal(Object.keys(f.state.laterOnIcons).length, 1);
  assert.deepEqual(core.fromStorage(f.state).items, original.laterOnItems);
  await f.api.migrateIcons();
  assert.equal(f.writes.length, 1);
  const restart = fixture(f.state, { subtle: { digest: () => { throw Error("Existing refs should not be rehashed"); } } });
  await restart.api.migrateIcons();
  assert.equal(restart.writes.length, 0);
  assert.deepEqual(restart.state, f.state);
});

test("startup leaves an absent collection untouched and still collects an orphan-only pool", async () => {
  const fresh = fixture();
  delete fresh.state.laterOnItems;
  await fresh.api.migrateIcons();
  assert.equal(fresh.writes.length, 0);
  assert.equal(Object.hasOwn(fresh.state, "laterOnItems"), false);
  const orphan = fixture({ laterOnIcons: { [digest(image("orphan"))]: image("orphan") } });
  await orphan.api.migrateIcons();
  assert.deepEqual(orphan.state.laterOnIcons, {});
  assert.equal(orphan.writes.length, 1);
});

test("hash failure and a mismatching digest retain original inline data", async () => {
  const value = image("a");
  const failed = fixture({ laterOnItems: [item("one", value)] }, { subtle: { digest: async () => { throw Error("unavailable"); } } });
  await failed.api.migrateIcons();
  assert.equal(failed.state.laterOnItems[0].favicon, value);
  assert.equal(failed.writes.length, 0);
  const hash = digest(value), other = image("other");
  const f = fixture({ laterOnItems: [item("inline", value), item("existing", `icon://${hash}`)], laterOnIcons: { [hash]: other } });
  await f.api.migrateIcons();
  assert.equal(f.state.laterOnItems[0].favicon, value);
  assert.equal(f.state.laterOnIcons[hash], other);
});

test("concurrent saves, edits and deletion share the pool, with no storage broadcast", async () => {
  const value = image("shared");
  const f = fixture({ laterOnItems: [item("remove", value), item("keep", value)] });
  await f.api.migrateIcons();
  const [saved, edited] = await Promise.all([
    f.api.saveItem({ url: "https://same.test/new", title: "New", favicon: value }, { silent: true }),
    f.api.execute({ action: "mutateItems", operation: "update", ids: ["keep"], patch: { title: "Edited" } }),
    f.api.execute({ action: "mutateItems", operation: "delete", ids: ["remove"] })
  ]);
  assert.equal(resolveFavicon(saved.item.favicon, saved.icons), value);
  assert.equal(resolveFavicon(edited.items.find(value => value.id === "keep").favicon, edited.icons), value);
  assert.equal(Object.keys(f.state.laterOnIcons).length, 1);
  assert.equal(f.state.laterOnItems.length, 2);
  assert.equal(f.state.laterOnItems.find(value => value.id === "keep").title, "Edited");
  const before = clone(f.state);
  f.failNext();
  await assert.rejects(f.api.execute({ action: "mutateItems", operation: "delete", ids: ["keep"] }), /disk full/);
  assert.deepEqual(f.state, before);
  await f.api.execute({ action: "mutateItems", operation: "delete", ids: ["keep"] });
  assert.equal(Object.keys(f.state.laterOnIcons).length, 1, "Another item still needs the shared image");
  await f.api.execute({ action: "mutateItems", operation: "delete", ids: f.state.laterOnItems.map(value => value.id) });
  assert.deepEqual(f.state.laterOnIcons, {});
});

test("batch saves, project deletion and expiry keep live images and collect the last reference", async () => {
  const value = image("shared"), expiredIcon = image("expired");
  const f = fixture({ laterOnProjects: [{ id: "p", name: "P", createdAt: 1 }], laterOnItems: [
    item("project", value, { projectId: "p" }), item("expired", expiredIcon, { status: "done", doneAt: 1 })
  ] });
  const batch = await f.api.runBatchSave({ tabs: [1, 2].map(id => ({ id, url: `https://batch.test/${id}`, title: `Batch ${id}`, discarded: true, favIconUrl: value })) });
  assert.equal(batch.ok, true);
  assert.equal(batch.added, 2);
  assert.equal(Object.keys(f.state.laterOnIcons).length, 2);
  await f.api.execute({ action: "deleteProject", id: "p" });
  assert.equal(Object.keys(f.state.laterOnIcons).length, 2);
  f.state.laterOnSettings.autoCleanEnabled = true;
  assert.equal(await f.api.purgeExpiredItems(), 1);
  assert.deepEqual(Object.keys(f.state.laterOnIcons), [digest(value)]);
  await f.api.execute({ action: "mutateItems", operation: "delete", ids: f.state.laterOnItems.map(value => value.id) });
  assert.deepEqual(f.state.laterOnIcons, {});
});

test("portable v1 backups round-trip images, deduplicate imports, fingerprint icons and wipe the pool", async () => {
  const value = image("one");
  const f = fixture({ laterOnItems: [item("one", value), item("two", value)], laterOnOrder: { all: ["two", "one"] }, laterOnReadingPositions: { one: 321 } });
  await f.api.migrateIcons();
  const exported = await f.send({ type: "BACKUP_EXPORT", includeImages: true });
  assert.equal(exported.ok, true);
  assert.equal(exported.payload.version, 1);
  assert.deepEqual(exported.payload.data.items.map(value => value.favicon), [value, value]);
  assert.ok(!JSON.stringify(exported.payload).includes("icon://"));
  const slim = await f.send({ type: "BACKUP_EXPORT" });
  assert.ok(slim.payload.data.items.every(value => value.favicon === ""));
  const preview = await f.send({ type: "BACKUP_PREVIEW", mode: "replace", payload: exported.payload });
  f.state.laterOnIcons[digest(image("orphan"))] = image("orphan");
  assert.equal((await f.send({ type: "BACKUP_APPLY", mode: "replace", payload: exported.payload, token: preview.token })).error, "IMPORT_DATA_CHANGED");
  const next = await f.send({ type: "BACKUP_PREVIEW", mode: "replace", payload: exported.payload });
  const before = clone(f.state);
  f.failNext();
  assert.equal((await f.send({ type: "BACKUP_APPLY", mode: "replace", payload: exported.payload, token: next.token })).ok, false);
  assert.deepEqual(f.state, before);
  assert.equal((await f.send({ type: "BACKUP_APPLY", mode: "replace", payload: exported.payload, token: next.token })).ok, true);
  assert.equal(Object.keys(f.state.laterOnIcons).length, 1);
  assert.deepEqual(core.fromStorage(f.state), clone(exported.payload.data));
  const incoming = clone(exported.payload);
  incoming.data.items = [item("three", value)];
  incoming.data.order = {}; incoming.data.readingPositions = {};
  const merge = await f.send({ type: "BACKUP_PREVIEW", mode: "merge", payload: incoming });
  assert.equal((await f.send({ type: "BACKUP_APPLY", mode: "merge", payload: incoming, token: merge.token })).ok, true);
  assert.equal(f.state.laterOnItems.length, 3);
  assert.equal(Object.keys(f.state.laterOnIcons).length, 1);
  delete f.state.laterOnIcons[digest(value)];
  assert.equal((await f.send({ type: "BACKUP_EXPORT", includeImages: true })).error, "MISSING_LOCAL_ICON");
  const withoutImages = await f.send({ type: "BACKUP_EXPORT" });
  assert.equal(withoutImages.ok, true, "An explicitly image-free backup does not need the missing image data");
  assert.ok(withoutImages.payload.data.items.every(value => value.favicon === ""));
  const repair = await f.send({ type: "BACKUP_PREVIEW", mode: "replace", payload: exported.payload });
  assert.equal(repair.ok, true, "A complete backup can repair an incomplete local pool");
  assert.equal((await f.send({ type: "BACKUP_APPLY", mode: "replace", payload: exported.payload, token: repair.token })).ok, true);
  assert.deepEqual(core.fromStorage(f.state), clone(exported.payload.data));
  assert.throws(() => core.parse({ ...exported.payload, data: { ...exported.payload.data, items: [item("raw", `icon://${digest(value)}`)] } }), /INVALID_BACKUP/);
  assert.equal((await f.send({ type: "COLLECTION_WIPE" })).ok, true);
  assert.deepEqual(f.state.laterOnIcons, {});
});
