const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../sidepanel.js'), 'utf8');
const helper = source.slice(source.indexOf('async function commitItemMutation('), source.indexOf('async function updateItem('));
const deletion = source.slice(source.indexOf('async function deleteItem(id)'), source.indexOf('\nfunction formatTime', source.indexOf('async function deleteItem(id)')));
let loadFailed = false, confirmed = false, writes = 0, loads = 0;
const context = vm.createContext({
  items: [{ id: 'a', title: 'A' }], covers: { a: 'cover' }, status: {}, tr: key => key,
  window: {}, render() {}, renderProjectFilters() {}, normalizeItems: list => list,
  ensureDialogLoaded: async () => {
    loads++;
    if (loadFailed) throw Error('load failed');
    context.window.LaterOnDialog = { confirm: async () => confirmed };
  },
  LaterOnStorage: { run: async () => { writes++; return { ok: true, items: [], covers: {} }; } }
});
vm.runInContext(helper + deletion, context);
(async () => {
  loadFailed = true;
  await context.deleteItem('a');
  assert.strictEqual(writes, 0, '确认组件加载失败绝不能直接删除');
  assert.strictEqual(context.items.length, 1);
  assert.strictEqual(context.status.textContent, 'operationFailed');
  loadFailed = false;
  await context.deleteItem('a');
  assert.strictEqual(writes, 0, '取消不删除');
  confirmed = true;
  await context.deleteItem('a');
  assert.strictEqual(loads, 3, '每次删除先确保确认组件可用');
  assert.strictEqual(writes, 1);
  assert.strictEqual(context.items.length, 0);
  assert.deepStrictEqual(context.covers, {});
  console.log('PASS 侧栏删除必须加载确认框、加载失败/取消不删除、确认后提交并清理封面');
})().catch(error => { console.error(error); process.exitCode = 1; });
