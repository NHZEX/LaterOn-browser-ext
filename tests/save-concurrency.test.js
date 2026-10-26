const sourcePath = require("./helpers/source-path.cjs");
// 真实后台代码 + 隔离、复制式 storage；不抓取网络、不读取真实收藏。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
  tabs: { onUpdated: event(), onRemoved: event(), onCreated: event() },
  action: {}, sidePanel: { setPanelBehavior() {} }
};
const ctx = vm.createContext({ chrome, console, URL, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {} });
vm.runInContext(require("./helpers/read-runtime.cjs")("url-utils.js"), ctx);
vm.runInContext(fs.readFileSync(sourcePath("background.js"), 'utf8'), ctx);
ctx.showActionFeedback = async () => {};
ctx.notifyTab = async () => {};
const page = name => ({ url: `https://fixture.test/${name}`, title: name, description: 'fixture', image: 'fixture-cover' });
const titles = () => store.laterOnItems.map(it => it.title).sort();
function gateExtraction() {
  let release, entered;
  const waiting = new Promise(r => { release = r; });
  const ready = new Promise(r => { entered = r; });
  ctx.extractTabMetadata = async tab => { entered(); await waiting; return tab; };
  return { ready, release };
}
(async () => {
  await ctx.purgeExpiredItems();
  let gate = gateExtraction();
  let batch = ctx.runBatchSave({ tabs: [page('batch')] });
  await gate.ready;
  await ctx.saveItem(page('single'), { silent: true });
  assert.deepStrictEqual(titles(), ['single']);
  gate.release();
  await batch;
  assert.deepStrictEqual(titles(), ['batch', 'single'], '批量完成不能覆盖期间单篇收藏');

  store.laterOnItems = [];
  await Promise.all([ctx.saveItem(page('one'), { silent: true }), ctx.saveItem(page('two'), { silent: true })]);
  assert.deepStrictEqual(titles(), ['one', 'two'], '同时保存两篇均保留');
  await Promise.all([ctx.saveItem(page('same'), { silent: true }), ctx.saveItem(page('same'), { silent: true })]);
  assert.strictEqual(store.laterOnItems.filter(it => it.title === 'same').length, 1, '并发同网址去重');

  gate = gateExtraction();
  batch = ctx.runBatchSave({ tabs: [page('next')] });
  await gate.ready;
  // 模拟用户在抓取等待时整理、标记、删除，均通过复制式存储提交。
  const current = (await local.get('laterOnItems')).laterOnItems;
  current.find(it => it.title === 'one').projectId = 'p2';
  current.find(it => it.title === 'one').status = 'done';
  await local.set({ laterOnItems: current.filter(it => it.title !== 'two') });
  gate.release();
  await batch;
  assert.deepStrictEqual(titles(), ['next', 'one', 'same']);
  assert.strictEqual(store.laterOnItems.find(it => it.title === 'one').projectId, 'p2');
  assert.strictEqual(store.laterOnItems.find(it => it.title === 'one').status, 'done');

  store.laterOnItems = [];
  gate = gateExtraction();
  const batches = [ctx.runBatchSave({ tabs: [page('b1'), page('b2')] }), ctx.runBatchSave({ tabs: [page('c1'), page('c2')] })];
  await gate.ready;
  gate.release();
  await Promise.all(batches);
  assert.deepStrictEqual(titles(), ['b1', 'b2', 'c1', 'c2']);
  for (const prefix of ['b', 'c']) assert(store.laterOnItems.findIndex(it => it.title === prefix+'1') < store.laterOnItems.findIndex(it => it.title === prefix+'2'), '批次内标签顺序保持');

  // 清理与保存共享后台写队列，期限规则保持原样。
  store.laterOnItems = [{ ...page('expired'), id: 'expired', status: 'done', doneAt: Date.now() - 31 * 86400000 }];
  const originalGet = local.get;
  let releasePurge, purgeEntered;
  const purgeReady = new Promise(r => { purgeEntered = r; });
  const purgeGate = new Promise(r => { releasePurge = r; });
  local.get = async keys => {
    const result = await originalGet(keys);
    if (Array.isArray(keys) && keys.includes('laterOnItems') && keys.includes('laterOnSettings')) {
      purgeEntered(); await purgeGate;
    }
    return result;
  };
  const purge = ctx.purgeExpiredItems();
  await purgeReady;
  const duringPurge = ctx.saveItem(page('during-purge'), { silent: true });
  releasePurge();
  await Promise.all([purge, duringPurge]);
  local.get = originalGet;
  assert.deepStrictEqual(titles(), ['during-purge'], '自动清理与保存不互相覆盖');

  // 旧快照读取期间关闭或延长清理期限，提交前必须放弃旧策略。
  for (const policy of [{ autoCleanEnabled: false }, { autoCleanDays: 180 }]) {
    store.laterOnSettings = { autoCleanEnabled: true, autoCleanDays: 30 };
    store.laterOnItems = [{ ...page('retained'), id: 'retained', status: 'done', doneAt: Date.now() - 60 * 86400000 }];
    let releaseSnapshot, signalSnapshot;
    const snapshotReady = new Promise(resolve => { signalSnapshot = resolve; });
    const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
    local.get = async keys => {
      const result = await originalGet(keys);
      if (Array.isArray(keys) && keys.includes('laterOnItems') && keys.includes('laterOnSettings')) {
        signalSnapshot(); await snapshotGate;
      }
      return result;
    };
    const pendingPurge = ctx.purgeExpiredItems();
    await snapshotReady;
    await local.set({ laterOnSettings: { ...store.laterOnSettings, ...policy } });
    releaseSnapshot();
    assert.strictEqual(await pendingPurge, 0);
    local.get = originalGet;
    assert.deepStrictEqual(titles(), ['retained'], '清理不能继续提交已失效的策略');
  }

  failWrite = true;
  await assert.rejects(ctx.saveItem(page('failed'), { silent: true }), /fixture write failure/);
  await ctx.saveItem(page('after-failure'), { silent: true });
  assert(titles().includes('after-failure'), '失败不堵塞后续保存');
  console.log('PASS 批量期间单篇保存、并发保存/去重、整理删除、两批并发、自动清理并发和失败恢复');
})().catch(error => { console.error(error); process.exitCode = 1; });
