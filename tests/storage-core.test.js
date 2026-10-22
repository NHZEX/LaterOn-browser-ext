const assert = require('node:assert/strict');
const { EPOCH, isCollectionCommand } = require('../src/storage/contracts.ts');
const { createStorageClient } = require('../src/storage/client.ts');

assert.equal(globalThis.LaterOnStorage, undefined);
assert.equal(globalThis.LaterOnCollection, undefined);
for (const command of [
  { action: 'createProject', name: 'Project' },
  { action: 'updateProject', id: 'p', changes: { name: 'New', note: '', coverPick: ['a'], archived: false } },
  { action: 'setProjectPinned', id: 'p', pinned: true },
  { action: 'moveProject', id: 'p', beforeId: null },
  { action: 'deleteProject', id: 'p' },
  { action: 'moveItem', id: 'a', scope: 'all', beforeId: 'b' },
  { action: 'mutateItems', operation: 'update', ids: ['a'], patch: { projectId: null, status: 'done', titleEdited: true, cover: '' } },
  { action: 'mutateItems', operation: 'delete', ids: [] },
  { action: 'migrateLegacyData' }
]) {
  const before = structuredClone(command);
  assert.equal(isCollectionCommand(command), true);
  assert.equal(isCollectionCommand({ ...command, epoch: 'restored' }), true);
  assert.deepEqual(command, before);
}
for (const command of [
  null, [], false, {}, { action: 'commit', patch: {} }, { action: 'constructor' },
  { action: 'migrateLegacyData', epoch: 1 }, { action: 'createProject', name: 1 },
  { action: 'updateProject', id: 'p', changes: { coverPick: [1] } },
  { action: 'updateProject', id: 'p', changes: { archived: 'true' } },
  { action: 'updateProject', id: 'p', changes: { arbitrary: true } },
  { action: 'moveItem', id: 'a', scope: 'all' },
  { action: 'setProjectPinned', id: 'p', pinned: 1 },
  { action: 'mutateItems', operation: 'replace', ids: [] },
  { action: 'mutateItems', operation: 'update', ids: [1] },
  { action: 'mutateItems', operation: 'update', ids: ['a'], patch: { status: 'invalid' } },
  { action: 'mutateItems', operation: 'update', ids: ['a'], patch: { projectId: {} } }
]) assert.equal(isCollectionCommand(command), false);

(async () => {
  const sent = [], failures = [];
  let invalidations = 0, rejectTransport = false;
  const client = createStorageClient({
    async sendMessage(message) {
      sent.push(message);
      if (rejectTransport) throw Error('Worker unavailable');
      return { ok: true, affected: 1 };
    },
    onInvalidated() { invalidations++; },
    onFailure(code) { failures.push(code); }
  });
  await assert.rejects(client.run('migrateLegacyData'), /COLLECTION_NOT_LOADED/);
  assert.equal(sent.length, 0);
  assert.equal(failures.length, 0);
  client.initialize({ [EPOCH]: 'original' });
  client.initialize({ [EPOCH]: 'replacement' });
  assert.equal((await client.run('mutateItems', { operation: 'delete', ids: ['a'] })).affected, 1);
  assert.deepEqual(sent[0], { type: 'COLLECTION_COMMAND', action: 'mutateItems', operation: 'delete', ids: ['a'], epoch: 'original' });
  rejectTransport = true;
  await assert.rejects(client.run('migrateLegacyData'), /COLLECTION_WRITE_FAILED/);
  assert.equal(failures.at(-1), 'COLLECTION_WRITE_FAILED');
  rejectTransport = false;
  assert.equal((await client.run('migrateLegacyData')).ok, true, 'A transport failure allows retry');
  client.invalidate();
  assert.equal(invalidations, 1);
  const sentBefore = sent.length;
  await assert.rejects(client.run('migrateLegacyData'), /STALE_COLLECTION/);
  assert.equal(sent.length, sentBefore, 'An invalidated page cannot send further commands');
  assert.equal(failures.at(-1), 'STALE_COLLECTION');

  const other = createStorageClient({
    async sendMessage(message) { assert.equal(message.epoch, ''); return undefined; },
    onInvalidated() { throw Error('Unrelated page was invalidated'); },
    onFailure(code) { assert.equal(code, 'COLLECTION_WRITE_FAILED'); }
  });
  other.initialize({});
  await assert.rejects(other.run('migrateLegacyData'), /COLLECTION_WRITE_FAILED/);
  console.log('PASS storage contracts and independent client epochs, initialization, invalidation, transport failure and retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
