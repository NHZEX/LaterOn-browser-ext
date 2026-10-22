// Real format, service-worker message handlers and collection queue with isolated storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const event = () => ({ addListener() {} });
const listeners = [];
let failWrite = false;
let writes = 0;
const store = { laterOnItems: [], laterOnProjects: [], laterOnSettings: { theme: 'dark', language: 'en' }, laterOnCleanupV165: true };
const local = {
  async get(keys) { return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]]))); },
  async set(patch) { if (failWrite) { failWrite = false; throw Error('disk full'); } writes++; Object.assign(store, clone(patch)); },
  async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
};
const chrome = {
  storage: { local, onChanged: event() }, alarms: { create() {}, onAlarm: event() },
  contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() }, commands: { onCommand: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: { addListener(fn) { listeners.push(fn); } }, getManifest: () => ({ version: '1.66.1' }), getURL: name => `chrome-extension://fixture/${name}` },
  tabs: { onUpdated: event(), onRemoved: event(), onCreated: event(), onActivated: event() }, action: {}, sidePanel: { setPanelBehavior() {} }
};
const ctx = vm.createContext({ chrome, URL, TextEncoder, crypto: webcrypto, console, setTimeout, clearTimeout, setInterval, clearInterval });
ctx.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), ctx, { filename: name }));
ctx.importScripts('background.js');
const core = ctx.LaterOnBackup;
const send = message => new Promise((resolve, reject) => {
  const handler = listeners.find(fn => fn(message, {}, resolve) === true);
  if (!handler) reject(Error(`No handler: ${message.type}`));
});
const item = (id, projectId = null, extra = {}) => ({ id, url: `https://example.com/${id}`, title: id, description: 'Summary', image: '', savedAt: 1, status: 'unread', projectId, ...extra });
const image = 'data:image/jpeg;base64,AAAA';
const data = () => ({
  items: [item('a', 'p', { image: 'local://a', status: 'reading', titleEdited: true, descriptionEdited: true, imageEdited: true }), item('b', null, { status: 'done', doneAt: 42 })],
  projects: [{ id: 'p', name: 'Project', createdAt: 1, archived: true, pinned: true, pinFrom: 2, note: 'Notes', cover: image, coverPick: ['a'] }],
  covers: { a: image }, order: { all: ['b', 'a'], p: ['a'], unfiled: ['b'] }, readingPositions: { a: 321 }
});
const payload = value => ({ format: core.FORMAT, version: 1, appVersion: '1', exportedAt: '2026-10-21T01:00:00.000Z', data: value });
const previews = new Map();
const preview = async (value, mode = 'merge') => {
  const file = payload(value);
  const result = await send({ type: 'BACKUP_PREVIEW', payload: file, mode });
  if (result.ok) previews.set(result.token, { payload: file, mode });
  return result;
};
const apply = token => send({ type: 'BACKUP_APPLY', token, ...previews.get(token) });

(async () => {
  await ctx.purgeExpiredItems();
  // Full round-trip includes inline legacy covers, project order and edit locks.
  Object.assign(store, core.toStorage(data()));
  store.laterOnItems[0].image = image;
  store.laterOnItems[0].favicon = image;
  store.laterOnItems[1].image = 'https://example.com/remote.jpg';
  store.laterOnItems[1].favicon = 'https://example.com/favicon.ico';
  store.laterOnCovers = {};
  store.laterOnOrder.missingProject = ['missing'];
  store.laterOnReadingPositions.orphan = 33;
  const beforeExport = clone(store);
  const slimExport = await send({ type: 'BACKUP_EXPORT' });
  assert.equal(slimExport.ok, true);
  const slim = clone(core.parse(slimExport.payload));
  assert.deepEqual(slim.covers, {});
  assert.equal(slim.items[0].image, '');
  assert.equal(slim.items[0].favicon, '');
  assert.equal(slim.projects[0].cover, '');
  assert.equal(slim.items[1].image, 'https://example.com/remote.jpg');
  assert.equal(slim.items[1].favicon, 'https://example.com/favicon.ico');
  assert(!JSON.stringify(slimExport.payload).includes('data:image'));
  assert(!JSON.stringify(slimExport.payload).includes('local://'));
  assert.deepEqual(clone(core.create(store, '1', '2026-10-21T01:00:00Z').data), slim);
  const exported = await send({ type: 'BACKUP_EXPORT', includeImages: true });
  assert.deepEqual(store, beforeExport, 'neither export mode changes local collection or images');
  assert.equal(exported.ok, true);
  const canonical = clone(core.parse(exported.payload));
  assert.equal(canonical.items[0].image, 'local://a');
  assert.equal(canonical.covers.a, image);
  assert.equal(canonical.items[0].favicon, image);
  assert.equal(canonical.projects[0].cover, image);
  assert.equal(canonical.items[0].titleEdited, true);
  assert.equal(canonical.projects[0].coverPick[0], 'a');
  assert.deepEqual(canonical.order.all, ['b', 'a']);
  assert.deepEqual(canonical.readingPositions, { a: 321 });
  assert(!JSON.stringify(exported.payload).includes('laterOnSettings'));
  assert(!JSON.stringify(exported.payload).includes('missingProject'));
  assert.deepEqual(slim.order, canonical.order);
  assert.deepEqual(slim.readingPositions, canonical.readingPositions);
  assert.deepEqual(slim.projects[0].coverPick, canonical.projects[0].coverPick);
  let response = await preview(slim, 'replace');
  assert.equal(response.ok, true);
  assert.equal((await apply(response.token)).ok, true);
  assert.deepEqual(clone(core.fromStorage(store)), slim, 'image-free export restores without missing references');
  const missingImageFields = clone(slim);
  delete missingImageFields.items[0].image;
  delete missingImageFields.items[0].favicon;
  delete missingImageFields.projects[0].cover;
  response = await preview(missingImageFields, 'replace');
  assert.equal(response.ok, true, 'optional image fields can also be absent');
  assert.equal((await apply(response.token)).ok, true);
  response = await preview(canonical, 'replace');
  assert.equal(response.ok, true);
  response = await apply(response.token);
  assert.equal(response.ok, true);
  assert.deepEqual(clone(core.fromStorage(store)), canonical);
  assert.deepEqual(store.laterOnSettings, { theme: 'dark', language: 'en' });
  assert.equal((await apply('old-token')).ok, false);

  // Invalid structure/references/protocols and incompatible versions never write.
  const badCases = [
    d => { d.items[0].url = 'javascript:alert(1)'; },
    d => { d.items.push(d.items[0]); },
    d => { d.items[0].projectId = 'missing'; },
    d => { d.covers = {}; },
    d => { d.order.p = ['b']; },
    d => { d.projects[0].coverPick = ['missing']; },
    d => { d.readingPositions.a = -1; },
    d => { d.covers.a = 'data:image/svg+xml;base64,AAAA'; },
    d => { d.order = JSON.parse('{"__proto__":[]}'); },
    d => { d.projects = {}; }
  ];
  for (const alter of badCases) {
    const invalid = data(); alter(invalid);
    const before = clone(store), count = writes;
    const result = await preview(invalid);
    assert.equal(result.ok, false, JSON.stringify(invalid));
    assert.equal(writes, count);
    assert.deepEqual(store, before);
  }
  assert.equal((await send({ type: 'BACKUP_PREVIEW', payload: { ...exported.payload, version: 99 }, mode: 'merge' })).error, 'UNSUPPORTED_BACKUP');
  assert.equal((await send({ type: 'BACKUP_PREVIEW', payload: { type: 'unrelated-backup', version: 2, items: [] }, mode: 'merge' })).error, 'UNSUPPORTED_BACKUP');
  const legacy = data();
  legacy.items[0].image = image;
  const parsedLegacy = clone(core.parse({ type: 'lateron-backup', version: 2, exportedAt: 1,
    items: legacy.items, projects: legacy.projects, covers: {}, order: legacy.order }));
  assert.equal(parsedLegacy.items[0].image, 'local://a');
  assert.equal(parsedLegacy.covers.a, image);
  assert.deepEqual(parsedLegacy.readingPositions, {});

  // URL matches retain local data. Item/project ID collisions remap every reference.
  const existing = { items: [item('a', 'p', { title: 'Local', status: 'done', doneAt: 99 })],
    projects: [{ id: 'p', name: 'Other', createdAt: 2 }], covers: {}, order: { all: ['a'] }, readingPositions: { a: 123 } };
  Object.assign(store, core.toStorage(existing));
  const incoming = data();
  incoming.items[0].url = 'https://new.example/article';
  incoming.items.push(item('duplicate', 'p', { url: existing.items[0].url, title: 'Remote' }));
  response = await preview(incoming);
  assert.equal(response.duplicates, 1);
  response = await apply(response.token);
  assert.equal(response.added, 2);
  const imported = store.laterOnItems.find(entry => entry.url === incoming.items[0].url);
  assert.notEqual(imported.id, 'a');
  assert.notEqual(imported.projectId, 'p');
  assert.equal(imported.image, `local://${imported.id}`);
  assert.equal(store.laterOnCovers[imported.id], image);
  assert.equal(store.laterOnReadingPositions[imported.id], 321);
  assert.deepEqual(store.laterOnProjects.find(entry => entry.id === imported.projectId).coverPick, [imported.id]);
  assert.deepEqual(store.laterOnOrder[imported.projectId], [imported.id]);
  assert.equal(store.laterOnItems.find(entry => entry.id === 'a').title, 'Local');
  assert.equal(store.laterOnReadingPositions.a, 123);
  response = await preview(incoming);
  response = await apply(response.token);
  assert.equal(response.added, 0);
  assert.equal(response.addedProjects, 0, 'repeat import must not recreate collision-remapped projects');

  // Two same-URL incoming entries cannot replace the accepted entry's cover/position.
  const duplicateData = data();
  duplicateData.items.push(item('same', 'p', { url: duplicateData.items[0].url, image: 'local://same' }));
  duplicateData.covers.same = 'data:image/png;base64,BBBB'; duplicateData.readingPositions.same = 99;
  const merged = core.merge(core.fromStorage({}), core.parse(payload(duplicateData)), ctx.LaterOnUrl.normalize, () => webcrypto.randomUUID());
  assert.equal(merged.data.covers.a, image);
  assert.equal(merged.data.readingPositions.a, 321);

  // Merge uses the same hash-route identity as collection and navigation.
  const routeA = 'https://routes.test/app#/article/1?b=2&a=1';
  const routeB = 'https://routes.test/app#/article/2?a=1&b=2';
  const localRoute = core.fromStorage({ laterOnItems: [item('route-local', null, { url: routeA })], laterOnReadingPositions: { 'route-local': 123 } });
  const routeImport = core.parse(payload({ items: [
    item('route-duplicate', null, { url: 'https://routes.test/app#/article/1?a=1&b=2' }),
    item('route-new', null, { url: routeB })
  ], projects: [], covers: {}, order: { all: ['route-duplicate', 'route-new'] }, readingPositions: { 'route-duplicate': 999, 'route-new': 456 } }));
  const routeMerged = core.merge(localRoute, routeImport, ctx.LaterOnUrl.normalize, () => webcrypto.randomUUID());
  assert.equal(routeMerged.added, 1);
  assert.equal(routeMerged.duplicates, 1);
  assert.deepEqual(clone(routeMerged.data.items.map(entry => entry.url)), [routeA, routeB], '合并保留不同 hash 页面及其原网址');
  assert.deepEqual(clone(routeMerged.data.readingPositions), { 'route-local': 123, 'route-new': 456 });
  assert.equal(core.merge(routeMerged.data, routeImport, ctx.LaterOnUrl.normalize, () => webcrypto.randomUUID()).added, 0, '重复导入路由备份仍幂等');

  // Merge re-reads the latest collection after preview; replace requires a fresh preview.
  response = await preview(data());
  await ctx.saveItem(item('during-preview'), { silent: true });
  assert.equal((await apply(response.token)).ok, true);
  assert(store.laterOnItems.some(entry => entry.url.endsWith('/during-preview')));
  response = await preview(data(), 'replace');
  await ctx.saveItem(item('before-replace'), { silent: true });
  const beforeChanged = clone(store);
  assert.equal((await apply(response.token)).error, 'IMPORT_DATA_CHANGED');
  assert.deepEqual(store, beforeChanged);

  // Failed writes leave the complete original collection intact; retry can succeed.
  response = await preview(data(), 'replace');
  const beforeFailure = clone(store);
  failWrite = true;
  assert.equal((await apply(response.token)).ok, false);
  assert.deepEqual(store, beforeFailure);
  response = await preview(data(), 'replace');
  assert.equal((await apply(response.token)).ok, true);

  // Old page commands cannot mutate a collection restored by import.
  const count = writes;
  await assert.rejects(send({ type: 'MUTATE_ITEMS', operation: 'delete', ids: ['a'] }), /No handler/);
  assert.equal((await send({ type: 'COLLECTION_COMMAND', action: 'mutateItems', operation: 'update', ids: ['a'], patch: { title: 'old' }, epoch: 'old-page' })).error, 'STALE_COLLECTION');
  assert.equal(writes, count);
  await ctx.saveItem(item('concurrent-save'), { silent: true });
  assert.equal((await send({ type: 'COLLECTION_COMMAND', action: 'mutateItems', operation: 'update', ids: ['a'], patch: { title: 'Updated' }, epoch: store.laterOnCollectionEpoch })).ok, true);
  assert(store.laterOnItems.some(entry => entry.url.endsWith('/concurrent-save')));

  // Simultaneous saves, imports and reading positions share the production queue.
  response = await preview(data());
  const saved = ctx.saveItem(item('simultaneous'), { silent: true });
  const applied = apply(response.token);
  const progress = send({ type: 'SAVE_READING_POSITION', itemId: 'a', y: 456 });
  await Promise.all([saved, applied, progress]);
  assert(store.laterOnItems.some(entry => entry.url.endsWith('/simultaneous')));
  assert.equal(store.laterOnReadingPositions.a, 456);

  // A batch can be extracting metadata while a restore removes its project.
  // Its eventual commit must not revive the deleted project reference.
  let enterExtraction, releaseExtraction;
  const extractionEntered = new Promise(resolve => { enterExtraction = resolve; });
  const extractionGate = new Promise(resolve => { releaseExtraction = resolve; });
  ctx.extractTabMetadata = async tab => { enterExtraction(); await extractionGate; return tab; };
  ctx.notifyTab = async () => {};
  ctx.showActionFeedback = async () => {};
  const batch = ctx.runBatchSave({ tabs: [item('after-restore')], projectId: 'p', projectName: 'Project' });
  await extractionEntered;
  response = await preview({ items: [], projects: [], covers: {}, order: {}, readingPositions: {} }, 'replace');
  assert.equal((await apply(response.token)).ok, true);
  releaseExtraction();
  await batch;
  assert.equal(store.laterOnItems.find(entry => entry.url.endsWith('/after-restore')).projectId, null);

  // Worker restarts discard all JS state; a reviewed file can still be applied.
  response = await preview(data(), 'replace');
  listeners.length = 0;
  ctx.importScripts('modules/storage/coordinator.js', 'modules/backup/background.js');
  assert.equal((await apply(response.token)).ok, true);
  assert.equal((await send({ type: 'COLLECTION_WIPE' })).ok, true);
  assert.deepEqual(store.laterOnItems, []);
  assert.deepEqual(store.laterOnReadingPositions, {});
  assert.equal(store.laterOnProjects.some(project => 'coverPick' in project), false);
  assert.deepEqual(store.laterOnSettings, { theme: 'dark', language: 'en' });
  console.log('PASS backup round-trip, validation, reference mapping, idempotency, preview, concurrency and failure recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
