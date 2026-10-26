const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const read = require('./helpers/read-runtime.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const store = { laterOnItems: [], laterOnProjects: [], laterOnCovers: {}, laterOnOrder: {}, laterOnReadingPositions: {} };
const changed = [], listeners = [];
let reads = 0, failWrite = false;
const local = {
  async get(keys) { reads++; return clone(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
  async set(patch) { if (failWrite) throw Error('write failure'); Object.assign(store, clone(patch)); }
};
const chrome = { storage: { local, onChanged: { addListener(fn) { changed.push(fn); } } },
  runtime: { onMessage: { addListener(fn) { listeners.push(fn); } }, getURL: name => `chrome-extension://fixture/${name}` } };
const backend = vm.createContext({ chrome, crypto: webcrypto });
vm.runInContext(read('collection-backend.js'), backend);
chrome.runtime.sendMessage = message => new Promise((resolve, reject) => {
  if (!listeners.some(fn => fn(message, {}, resolve) === true)) reject(Error('No handler'));
});
function page() {
  const state = { reloads: 0, cacheCleared: 0, alerts: [] };
  const ctx = vm.createContext({ chrome, location: { pathname: '/library.html', reload() { state.reloads++; } },
    localStorage: { removeItem() { state.cacheCleared++; } },
    LaterOnDialog: { async alert(config) { state.alerts.push(config); } }, LaterOnI18n: { t: key => key } });
  ctx.window = ctx;
  vm.runInContext(read('storage-client.js'), ctx);
  return { api: ctx.LaterOnStorage, state };
}
(async () => {
  const first = page(), second = page();
  assert.equal(reads, 0, 'no extra reads during page startup');
  first.api.initialize(clone(store)); second.api.initialize(clone(store));
  assert.equal(first.api.commit, undefined, 'whole collection patch API is removed');
  const one = (await first.api.run('createProject', { name: 'One' })).project;
  const two = (await second.api.run('createProject', { name: 'Two' })).project;
  assert.deepEqual(store.laterOnProjects.map(p => p.name), ['One', 'Two'], 'delayed notifications cannot drop another page project');
  // Both pages keep operating with no storage notifications and no refreshed snapshots.
  await Promise.all([
    first.api.run('updateProject', { id: one.id, changes: { name: 'Renamed' } }),
    second.api.run('updateProject', { id: one.id, changes: { note: 'Concurrent note' } })
  ]);
  assert.equal(store.laterOnProjects[0].name, 'Renamed');
  assert.equal(store.laterOnProjects[0].note, 'Concurrent note');
  await second.api.run('moveProject', { id: two.id, beforeId: one.id });
  assert.equal(store.laterOnProjects[1].note, 'Concurrent note', 'moving preserves latest project fields');
  const same = await first.api.run('createProject', { name: 'Renamed' });
  assert.equal(same.project.id, one.id);
  assert.equal(store.laterOnProjects.length, 2);
  await first.api.run('updateProject', { id: two.id, changes: { archived: true } });
  assert.equal((await second.api.run('createProject', { name: 'Two' })).project.id, two.id, 'archived names do not create duplicates');
  await first.api.run('updateProject', { id: two.id, changes: { archived: false } });

  store.laterOnItems = [
    { id: 'a', projectId: one.id, savedAt: 1 }, { id: 'b', projectId: one.id, savedAt: 2 },
    { id: 'new', projectId: one.id, savedAt: 3 }, { id: 'elsewhere', projectId: two.id, savedAt: 4 }
  ];
  store.laterOnOrder = { [one.id]: ['a', 'b'], [two.id]: ['elsewhere'] };
  await first.api.run('moveItem', { id: 'b', scope: one.id, beforeId: 'a' });
  assert.deepEqual(store.laterOnOrder[one.id], ['b', 'a', 'new'], 'unseen new items survive ordering');
  assert.deepEqual(store.laterOnOrder[two.id], ['elsewhere']);
  await first.api.run('setProjectPinned', { id: one.id, pinned: true });
  await second.api.run('moveProject', { id: two.id, beforeId: one.id });
  assert.equal(store.laterOnProjects[0].id, one.id, 'moves cannot cross pinned partition');
  await second.api.run('setProjectPinned', { id: one.id, pinned: true });
  await first.api.run('setProjectPinned', { id: one.id, pinned: false });
  assert.equal(store.laterOnProjects[1].id, one.id, 'pin/unpin is idempotent and restores former position');

  const image = 'data:image/jpeg;base64,AAAA';
  await Promise.all([
    first.api.run('mutateItems', { operation: 'update', ids: ['a'], patch: { cover: image } }),
    second.api.run('mutateItems', { operation: 'update', ids: ['b'], patch: { cover: image } })
  ]);
  assert.equal(store.laterOnCovers.a, image);
  assert.equal(store.laterOnCovers.b, image, 'concurrent cover commands retain both uploads');
  store.laterOnItems.push(null, { id: 'legacy', image, read: true });
  await first.api.run('migrateLegacyData');
  const migrated = store.laterOnItems.find(item => item.id === 'legacy');
  assert.equal(migrated.image, 'local://legacy');
  assert(store.laterOnItems.every(Boolean), 'legacy null entries cannot break page initialization');
  assert(migrated.doneAt > 0);
  assert.equal(store.laterOnCovers.legacy, image);
  store.laterOnItems = store.laterOnItems.map(item => item.id === 'legacy' ? { ...item, image: 'https://example.com/latest.jpg' } : item);
  await second.api.run('migrateLegacyData');
  assert.equal(store.laterOnItems.find(item => item.id === 'legacy').image, 'https://example.com/latest.jpg', 'late migration uses current records');
  assert.equal(store.laterOnItems.find(item => item.id === 'legacy').doneAt, migrated.doneAt);

  store.laterOnCollectionEpoch = 'restored';
  const before = clone(store);
  await assert.rejects(first.api.run('updateProject', { id: one.id, changes: { name: 'Old' } }), /STALE_COLLECTION/);
  assert.deepEqual(store, before, 'old commands rejected even before epoch notification');
  changed.forEach(fn => fn({ laterOnCollectionEpoch: { newValue: 'restored' } }, 'local'));
  assert.equal(first.state.cacheCleared, 1);
  assert.equal(first.state.alerts[0].message, 'backupDataChanged');
  const fresh = page(); fresh.api.initialize(clone(store));
  failWrite = true;
  await assert.rejects(fresh.api.run('updateProject', { id: one.id, changes: { name: 'Retry' } }), /write failure/);
  assert.deepEqual(store, before);
  assert.equal(fresh.state.reloads, 0, 'ordinary write failure keeps the page available for retry');
  failWrite = false;
  await fresh.api.run('updateProject', { id: one.id, changes: { name: 'Retry' } });
  assert.equal(store.laterOnProjects.find(p => p.id === one.id).name, 'Retry');
  await assert.rejects(backend.collectionBackend.execute({ action: 'commit', patch: { laterOnItems: [] } }), /INVALID_OPERATION/);
  const invalid = await chrome.runtime.sendMessage({ type: 'COLLECTION_COMMAND', action: 'deleteProject', id: one.id });
  assert.equal(invalid.ok, false, 'page commands must carry an epoch');
  const sendFrom = (message, sender) => new Promise(resolve => listeners[0](message, sender, resolve));
  const latest = clone(store), readsBefore = reads;
  for (const command of [
    { action: 'commit', patch: {} },
    { action: 'updateProject', id: one.id, changes: { archived: 'false' } },
    { action: 'mutateItems', operation: 'update', ids: [1] }
  ]) {
    const response = await sendFrom({ ...command, type: 'COLLECTION_COMMAND', epoch: 'restored' }, {});
    assert.equal(response.ok, false);
    assert.equal(response.error, 'INVALID_OPERATION');
  }
  const denied = await sendFrom({ type: 'COLLECTION_COMMAND', action: 'deleteProject', id: one.id, epoch: 'restored' },
    { tab: { id: 9 }, url: 'https://example.com' });
  assert.equal(denied.error, 'INVALID_SENDER');
  assert.equal(reads, readsBefore, 'Malformed commands and external senders are rejected before storage reads');
  assert.deepEqual(store, latest);
  console.log('PASS semantic commands: concurrent edits, latest-data ordering, pinned groups, epoch rejection, failure retry; no writable snapshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
