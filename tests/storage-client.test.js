const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const read = require('./helpers/read-runtime.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const store = { laterOnItems: [], laterOnProjects: [], laterOnCovers: {}, laterOnOrder: {}, laterOnReadingPositions: {} };
const changed = [], listeners = [], writes = [];
let reads = 0, failWrite = false;
const local = {
  async get(keys) { reads++; return clone(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
  async set(patch) { if (failWrite) throw Error('write failure'); writes.push(clone(patch)); Object.assign(store, clone(patch)); }
};
const chrome = { storage: { local, onChanged: { addListener(fn) { changed.push(fn); } } },
  runtime: { onMessage: { addListener(fn) { listeners.push(fn); } }, getURL: name => `chrome-extension://fixture/${name}` } };
const backend = vm.createContext({ chrome, crypto: webcrypto, URL });
vm.runInContext(read('collection-backend.js'), backend);
chrome.runtime.sendMessage = message => new Promise((resolve, reject) => {
  if (!listeners.some(fn => fn(message, {}, resolve) === true)) reject(Error('No handler'));
});
function page() {
  const state = { reloads: 0, cacheCleared: 0, alerts: [] };
  const ctx = vm.createContext({ chrome, location: { pathname: '/library.html', reload() { state.reloads++; } },
    localStorage: { removeItem() { state.cacheCleared++; } },
  });
  ctx.window = ctx;
  vm.runInContext(read('storage-client.js'), ctx);
  ctx.LaterOnStorage.setFailureHandler(async code => { if (code === 'STALE_COLLECTION') state.alerts.push({ message: 'backupDataChanged' }); });
  return { api: ctx.LaterOnStorage, state };
}
(async () => {
  const first = page(), second = page();
  assert.equal(reads, 0, 'no extra reads during page startup');
  first.api.initialize(clone(store)); second.api.initialize(clone(store));
  store.laterOnItems = [{ id: 'trip', title: 'Original', description: 'Original summary', pendingEdits: { title: ['Legacy text'] } }];
  const basis = { title: { value: 'Original', revision: null }, description: { value: 'Original summary', revision: null } };
  const update = (api, patch, editBasis) => api.run('mutateItems', { operation: 'update', ids: ['trip'], patch, editBasis });
  await update(second.api, { title: 'Current' });
  assert.deepEqual(writes.at(-1).laterOnOverrideLog.map(({ kind, value }) => [kind, value]), [['legacy', 'Legacy text']]);
  assert.equal('pendingEdits' in writes.at(-1).laterOnItems[0], false, 'Migration commits recovery and removes the candidates together');
  const beforeDraft = writes.length;
  const saved = await update(first.api, { title: 'Stale draft', titleEdited: true, description: 'Saved summary', descriptionEdited: true }, basis);
  assert.equal(saved.editConflict, 'partial');
  assert.equal(store.laterOnItems[0].title, 'Current');
  assert.equal(store.laterOnItems[0].description, 'Saved summary');
  assert.equal('pendingEdits' in store.laterOnItems[0], false);
  assert.equal(writes.length, beforeDraft + 1);
  assert.deepEqual(writes.at(-1).laterOnOverrideLog.map(({ kind, value }) => [kind, value]), [['draft', 'Stale draft'], ['legacy', 'Legacy text']]);
  assert.equal(writes.at(-1).laterOnItems[0].description, 'Saved summary');
  const list = () => first.api.run('listEditRecovery', {});
  assert.equal((await list()).editRecovery.length, 2);
  await update(first.api, { title: 'Stale draft', titleEdited: true }, basis);
  assert.equal((await list()).editRecovery.length, 2, 'Retry does not duplicate the same draft');
  await update(second.api, { title: 'Original' });
  const reverted = await update(first.api, { title: 'Stale after revert' }, basis);
  assert.equal(reverted.editConflict, 'pending');
  assert.equal(store.laterOnItems[0].title, 'Original', 'A reverted value still has a different revision');
  await Promise.all(Array.from({ length: 101 }, (_, index) => update(first.api, { title: `Draft ${index}` }, basis)));
  const bounded = (await list()).editRecovery;
  assert.equal(bounded.length, 100);
  assert.equal(bounded[0].value, 'Draft 100');
  assert.equal(bounded.at(-1).value, 'Draft 1');
  await first.api.run('clearEditRecovery', {});
  assert.deepEqual(clone((await list()).editRecovery), []);
  assert.equal('pendingEdits' in store.laterOnItems[0], false);
  store.laterOnItems = [];
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
  const topicLink = 'https://forum.test/t/topic/42';
  const bookmark = { id: 'bookmark', url: `${topicLink}/14`, title: 'Handwritten title', projectId: one.id, savedAt: 7, status: 'done' };
  const otherBookmark = { id: 'other-post', url: 'https://forum.test/t/42/16' };
  store.laterOnItems = [...store.laterOnItems, bookmark, otherBookmark];
  store.laterOnReadingPositions = { bookmark: 850, 'other-post': 500 };
  const moveTo = (postNumber, expectedUrl = bookmark.url) => fresh.api.run('updateDiscoursePosition', {
    id: bookmark.id, expectedUrl, url: `${topicLink}/${postNumber}`,
    topic: { origin: 'https://forum.test', basePath: '', topicId: '42', postNumber }
  });
  const beforeMove = clone(store);
  await assert.rejects(moveTo('16'), /DISCOURSE_POSITION_ALREADY_SAVED/);
  store.laterOnSyncMeta = { trialEnabled: true, binding: {} };
  await assert.rejects(moveTo('15'), /DISCOURSE_POSITION_SYNC_BOUND/);
  store.laterOnSyncMeta = beforeMove.laterOnSyncMeta;
  assert.deepEqual(store, beforeMove);
  await moveTo('15');
  await assert.rejects(moveTo('17'), /STALE_ITEM/);
  assert.deepEqual(store.laterOnItems.find(item => item.id === bookmark.id), { ...bookmark, url: `${topicLink}/15` });
  assert.deepEqual(store.laterOnReadingPositions, { 'other-post': 500 });
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
