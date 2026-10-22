const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const read = require("./helpers/read-runtime.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function run(language) {
  const dom = new JSDOM(read('settings.html'), { runScripts: 'outside-only', url: 'chrome-extension://fixture/settings.html' });
  const { window } = dom;
  const store = { laterOnItems: [], laterOnProjects: [], laterOnSettings: { language, theme: 'dark' } };
  const handlers = [], changes = [], messages = [], alerts = [], confirms = [], downloads = [];
  let confirm = true, failWrite = false;
  const chrome = {
    storage: { local: {
      async get(keys) { return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]]))); },
      async set(patch) {
        if (failWrite) { failWrite = false; throw Error('fixture write failure'); }
        const events = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: store[key], newValue: value }]));
        Object.assign(store, clone(patch)); changes.forEach(fn => fn(events, 'local'));
      }
    }, onChanged: { addListener(fn) { changes.push(fn); } } },
    runtime: { getManifest: () => ({ version: '1.66.1' }), getURL: name => `chrome-extension://fixture/${name}`,
      onMessage: { addListener(fn) { handlers.push(fn); } },
      sendMessage(message) { messages.push(message); return new Promise(resolve => handlers.some(fn => fn(message, {}, resolve) === true)); }
    }
  };
  const backend = vm.createContext({ chrome, URL, TextEncoder, crypto: webcrypto });
  for (const file of ['url-utils.js', 'modules/storage/coordinator.js', 'backup-core.js', 'modules/backup/background.js']) vm.runInContext(read(file), backend);
  window.chrome = chrome;
  window.eval(read('i18n.js'));
  await window.LaterOnI18n.getLanguage();
  window.LaterOnI18n.applyStatic();
  window.LaterOnDialog = { async confirm(config) { confirms.push(config); return confirm; }, async alert(config) { alerts.push(config); } };
  window.Blob = Blob;
  window.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:fixture'; };
  const released = [];
  window.URL.revokeObjectURL = url => released.push(url);
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  window.eval(read('modules/backup/settings.js'));
  const input = window.document.querySelector('#importFile');
  const exportButton = window.document.querySelector('#exportBtn');
  const exportImages = window.document.querySelector('#exportImages');
  assert.equal(exportImages.checked, false, 'image data is excluded by default');
  assert.equal(exportImages.labels[0].textContent.trim(), language === 'en' ? 'Include image data (larger file)' : '包含图片数据（文件较大）');
  const select = window.document.querySelector('#importMode');
  const payload = { format: 'lateron.collection', version: 1, appVersion: '1', exportedAt: '2026-10-21T01:00:00Z', data: {
    items: [{ id: 'a', url: 'https://example.com/a', title: 'A', projectId: 'p', status: 'reading', savedAt: 1, image: 'local://a', favicon: 'data:image/png;base64,BBBB' }],
    projects: [{ id: 'p', name: 'Project', createdAt: 1, cover: 'data:image/png;base64,CCCC' }], covers: { a: 'data:image/jpeg;base64,AAAA' }, order: { p: ['a'] }, readingPositions: { a: 123 }
  } };
  const importFile = async (text, size = 1) => {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size, text: async () => text }] });
    input.dispatchEvent(new window.Event('change'));
    assert.equal(exportButton.disabled, true, 'busy state prevents overlapping operations');
    assert.equal(exportImages.disabled, true);
    for (let i = 0; i < 100 && exportButton.disabled; i++) await tick();
    assert.equal(exportButton.disabled, false);
    assert.equal(exportImages.disabled, false);
    assert.equal(input.value, '', 'same file can be selected again');
  };
  // Preview cancellation writes nothing. Both modes have explicit localized confirmation.
  confirm = false;
  await importFile(JSON.stringify(payload));
  assert.equal(store.laterOnItems.length, 0);
  assert.equal(messages.filter(m => m.type === 'BACKUP_APPLY').length, 0);
  assert(!confirms[0].message.includes('{items}'));
  assert(confirms[0].message.includes('1'));
  assert.equal(confirms[0].tone, 'question');
  assert.equal(confirms[0].confirmText, language === 'en' ? 'Merge import' : '合并导入');
  confirm = true;
  await importFile('\uFEFF' + JSON.stringify(payload));
  assert.equal(store.laterOnItems.length, 1);
  assert.equal(store.laterOnReadingPositions.a, 123);
  assert.equal(alerts.at(-1).tone, 'success');
  assert(!alerts.at(-1).message.includes('{total}'));
  await importFile(JSON.stringify(payload));
  assert.equal(store.laterOnItems.length, 1, 'repeated merge is idempotent');
  const beforeBad = clone(store);
  await importFile('{broken');
  assert.equal(alerts.at(-1).tone, 'danger');
  assert.deepEqual(store, beforeBad);
  await importFile('{}', 50 * 1024 * 1024 + 1);
  assert.equal(alerts.at(-1).tone, 'danger');
  assert.deepEqual(store, beforeBad);
  select.value = 'replace';
  const replacement = clone(payload); replacement.data.items[0].title = 'Restored';
  await importFile(JSON.stringify(replacement));
  assert.equal(confirms.at(-1).tone, 'danger');
  assert.equal(store.laterOnItems[0].title, 'Restored');
  assert.deepEqual(store.laterOnSettings, { language, theme: 'dark' });
  const beforeFailure = clone(store);
  failWrite = true;
  await importFile(JSON.stringify(payload));
  assert.deepEqual(store, beforeFailure);
  assert.equal(alerts.at(-1).tone, 'danger');
  exportButton.click();
  for (let i = 0; i < 100 && exportButton.disabled; i++) await tick();
  assert.equal(exportButton.disabled, false);
  assert.equal(downloads.length, 2);
  const exported = JSON.parse(await downloads[0].text());
  assert.equal(exported.format, 'lateron.collection');
  assert.equal(exported.data.items[0].title, 'Restored');
  assert.equal(exported.data.readingPositions.a, 123);
  assert.deepEqual(exported.data.covers, {});
  assert.equal(exported.data.items[0].image, '');
  assert.equal(exported.data.items[0].favicon, '');
  assert.equal(exported.data.projects[0].cover, '');
  assert(!JSON.stringify(exported).includes('data:image'));
  assert.match(downloads[1], /^lateron-backup-.*\.json$/);
  const collectionBeforeExport = clone(store);
  exportImages.checked = true;
  exportButton.click();
  for (let i = 0; i < 100 && exportButton.disabled; i++) await tick();
  assert.equal(downloads.length, 4);
  const fullExport = JSON.parse(await downloads[2].text());
  assert.deepEqual(fullExport.data.covers, payload.data.covers);
  assert.equal(fullExport.data.items[0].image, 'local://a');
  assert.equal(fullExport.data.items[0].favicon, payload.data.items[0].favicon);
  assert.equal(fullExport.data.projects[0].cover, payload.data.projects[0].cover);
  assert.deepEqual(store, collectionBeforeExport);
  await importFile(JSON.stringify(exported));
  assert.equal(store.laterOnItems[0].image, '');
  assert.deepEqual(store.laterOnCovers, {});
  assert.equal(store.laterOnReadingPositions.a, 123);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.deepEqual(released, ['blob:fixture', 'blob:fixture']);
  dom.window.close();
}

(async () => {
  await run('zh-CN');
  await run('en');
  console.log('PASS bilingual backup UI: cancel, merge, replace, invalid/oversized files, write failure, download and retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
