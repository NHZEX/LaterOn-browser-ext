const sourcePath = require("./helpers/source-path.cjs");
// 真实后台代码 + 隔离、复制式 storage；不抓取网络、不读取真实收藏。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createWorkerContext } = require("./helpers/worker-context.cjs");
const { webcrypto } = require('crypto');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const event = () => ({ addListener() {} });
const store = { laterOnItems: [], laterOnSettings: {} };
let failWrite = false;
const local = {
  async get(keys) {
    const names = typeof keys === 'string' ? [keys] : keys;
    return clone(Object.fromEntries(names.filter(k => k in store).map(k => [k, store[k]])));
  },
  async set(patch) {
    if (failWrite && patch.laterOnItems) { failWrite = false; throw new Error('fixture write failure'); }
    Object.assign(store, clone(patch));
  }
};
const chrome = {
  storage: { local, onChanged: event() },
  alarms: { create() {}, onAlarm: event() },
  contextMenus: { removeAll(cb) { cb?.(); }, create() {}, onClicked: event() },
  commands: { onCommand: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: p => `chrome-extension://fixture/${p}` },
  tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), onCreated: event() },
  action: {}, sidePanel: { setPanelBehavior() {} }
};
const ctx = createWorkerContext({ chrome, console, URL, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {} });
vm.runInContext(require("./helpers/read-runtime.cjs")("url-utils.js"), ctx);
vm.runInContext(require("./helpers/read-runtime.cjs")("background-test-api.js"), ctx);
const mutateItems = fields => ctx.backgroundTest.execute({ ...fields, action: 'mutateItems', epoch: store.laterOnCollectionEpoch || '' });
const page = name => ({ url: `https://fixture.test/${name}`, title: name, image: "", id: name, projectId: "p" });
(async () => {
  store.laterOnItems = [page('delete'), page('keep'), page('recent')];
  store.laterOnCovers = { delete: 'data:delete', keep: 'data:keep' };
  store.laterOnOrder = { all: ['delete', 'keep'], project: ['delete', 'recent'] };
  store.laterOnCurrentItem = 'delete';
  store.laterOnProjects = [{ id: 'p', name: 'P', coverPick: ['delete', 'keep'] }];
  let result = await mutateItems({ operation: 'delete', ids: ['delete', 'missing'] });
  assert.strictEqual(result.affected, 1);
  assert.deepStrictEqual(store.laterOnItems.map(it => it.id), ['keep', 'recent']);
  assert.deepStrictEqual(store.laterOnCovers, { keep: 'data:keep' });
  assert.deepStrictEqual(store.laterOnOrder, { all: ['keep'], project: ['recent'] });
  assert.strictEqual(store.laterOnCurrentItem, null);
  assert.deepStrictEqual(store.laterOnProjects[0].coverPick, ['keep']);

  store.laterOnItems = [page('keep'), page('delete')];
  await Promise.all([
    ctx.backgroundTest.saveItem(page('concurrent'), { silent: true }),
    mutateItems({ operation: 'delete', ids: ['delete'] }),
    mutateItems({ operation: 'update', ids: ['delete'], patch: { status: 'reading' } })
  ]);
  assert.deepStrictEqual(store.laterOnItems.map(it => it.title).sort(), ['concurrent', 'keep'], '并发添加保留，迟到的状态更新不能复活已删除网页');

  store.laterOnCovers = { keep: 'data:keep' };
  const before = clone(store);
  failWrite = true;
  await assert.rejects(mutateItems({ operation: 'delete', ids: ['keep'] }), /fixture write failure/);
  assert.deepStrictEqual(store, before, '提交失败时网页、封面和排序均不改变');
  result = await mutateItems({ operation: 'delete', ids: ['keep'] });
  assert.strictEqual(result.affected, 1, '失败后可以重试，队列不会堵塞');
  assert.strictEqual(store.laterOnCovers.keep, undefined);

  store.laterOnItems = [{ ...page('done'), status: 'done', doneAt: 123 }];
  await mutateItems({ operation: 'update', ids: ['done'], patch: { status: 'done' } });
  assert.strictEqual(store.laterOnItems[0].doneAt, 123, '已读日期不因重复标记重置');
  await assert.rejects(mutateItems({ operation: 'invalid', ids: [] }), /Invalid/);

  const editBasis = { title: { value: 'done', revision: null }, description: { value: null, revision: null } };
  const edit = { operation: 'update', ids: ['done'], patch: { title: 'Handwritten title', titleEdited: true }, editBasis };
  const beforeEdit = clone(store);
  failWrite = true;
  await assert.rejects(mutateItems(edit), /fixture write failure/);
  assert.deepStrictEqual(store, beforeEdit, '编辑失败时不保存字段修订，也不推进本机时钟');
  await mutateItems(edit);
  const edited = store.laterOnItems[0];
  const editedMeta = clone(store.laterOnSyncMeta);
  assert.strictEqual(edited.title, 'Handwritten title');
  assert.strictEqual(typeof edited.editRevisions.title, 'string', '仍以字符串形式持久化编辑基线');
  assert.ok(editedMeta.clock.wallTime > 0);
  assert.strictEqual(edited.editRevisions.description, undefined, '只记录实际改动的字段');
  await mutateItems(edit);
  assert.deepStrictEqual(store.laterOnSyncMeta, editedMeta, '重复提交同一值不推进本机时钟');
  assert.deepStrictEqual(store.laterOnItems[0], edited);

  const duplicate = await ctx.backgroundTest.saveItem({ url: edited.url, title: 'Fetched title', description: 'Fetched summary' }, { silent: true });
  assert.strictEqual(duplicate.duplicated, true);
  assert.strictEqual(duplicate.item.title, edited.title, '自动补全不覆盖手写标题');
  assert.strictEqual(duplicate.item.editRevisions.title, edited.editRevisions.title);
  assert.strictEqual(duplicate.item.description, 'Fetched summary');
  assert.notStrictEqual(duplicate.item.descriptionEdited, true);
  assert.deepStrictEqual(store.laterOnSyncMeta, editedMeta);

  console.log('PASS 删除原子提交、并发添加/修改、失败保留与重试、未绑定手写修订');
})().catch(error => { console.error(error); process.exitCode = 1; });
