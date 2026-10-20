// Exercise both page mutation handlers against the real command backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const oldCover = 'data:image/jpeg;base64,T0xE', newCover = 'data:image/jpeg;base64,TkVX';
(async () => {
  for (const name of ['library.js', 'sidepanel.js']) {
    const source = read(name);
    const start = source.indexOf('async function commitItemMutation(');
    const end = source.indexOf('async function updateItem(', start);
    const store = { laterOnItems: [{ id: 'a', title: 'Old', image: 'local://a' }], laterOnCovers: { a: oldCover, other: oldCover } };
    let fail = true, writes = 0, message;
    const local = {
      async get(keys) { return clone(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
      async set(patch) { if (fail) throw Error('write failure'); writes++; Object.assign(store, clone(patch)); }
    };
    const backend = vm.createContext({ chrome: { storage: { local }, runtime: { onMessage: { addListener() {} } } } });
    vm.runInContext(read('modules/storage/coordinator.js'), backend);
    const context = vm.createContext({
      items: clone(store.laterOnItems), covers: clone(store.laterOnCovers),
      normalizeItems: value => value, render() {}, renderProjects() {}, renderProjectFilters() {},
      tr: key => key, showToast: text => { message = text; }, status: {},
      LaterOnStorage: { run: (action, fields) => backend.LaterOnCollection.execute({ action, ...fields, epoch: '' }) }
    });
    vm.runInContext(source.slice(start, end), context);
    const before = clone(store);
    assert.equal(await context.commitItemMutation('update', ['a'], { title: 'New', cover: newCover }), null);
    assert.deepEqual(store, before, 'failed cover edit retains both image and pointer');
    assert.equal(context.items[0].title, 'Old');
    assert.equal(context.covers.a, oldCover);
    assert.equal(message || context.status.textContent, 'operationFailed');
    fail = false;
    assert.equal((await context.commitItemMutation('update', ['a'], { title: 'New', cover: newCover })).ok, true);
    assert.equal(writes, 1, 'cover data and item pointer commit together');
    assert.equal(store.laterOnItems[0].title, 'New');
    assert.equal(store.laterOnItems[0].image, 'local://a');
    assert.equal(store.laterOnCovers.a, newCover);
    assert.equal(store.laterOnCovers.other, oldCover, 'another item cover is preserved');
    fail = true;
    const beforeRemove = clone(store);
    assert.equal(await context.commitItemMutation('update', ['a'], { cover: '' }), null);
    assert.deepEqual(store, beforeRemove);
    fail = false;
    await context.commitItemMutation('update', ['a'], { cover: '' });
    assert.equal(store.laterOnItems[0].image, '');
    assert.equal(store.laterOnCovers.a, undefined);
    const count = writes;
    await context.commitItemMutation('update', ['deleted'], { cover: newCover });
    assert.equal(store.laterOnCovers.deleted, undefined, 'late edit cannot leave an orphan cover');
    assert.equal(store.laterOnItems.length, 1);
    assert.equal(writes, count + 1);
    store.laterOnItems.push(null, { id: 'legacy', image: oldCover, read: true });
    const migrateStart = source.indexOf('async function migrateLegacyCovers(');
    const migrateEnd = source.indexOf('\n}', migrateStart) + 2;
    vm.runInContext(source.slice(migrateStart, migrateEnd), context);
    const migrated = await context.migrateLegacyCovers(clone(store.laterOnItems));
    assert(migrated.every(Boolean), 'page migration tolerates null records');
    assert.equal(migrated.find(item => item.id === 'legacy').image, 'local://legacy');
  }
  console.log('PASS both pages: cover and pointer commit together, failed writes preserve data, retry and removal succeed');
})().catch(error => { console.error(error); process.exitCode = 1; });
