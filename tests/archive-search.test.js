// 两个真实页面使用隔离 storage，检查普通搜索隐藏归档、归档视图搜索与恢复同步。
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = require("./helpers/read-runtime.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const wait = ms => new Promise(r => setTimeout(r, ms));
function mount(page) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(read(page+'.html'), { runScripts: 'outside-only', pretendToBeVisual: true, url: `chrome-extension://fixture/${page}.html`, virtualConsole: vc });
  const w = dom.window;
  const store = {
    laterOnItems: [{ id: 'a', title: 'archive needle', description: 'fixture', source: 'fixture.test', url: 'https://fixture.test/a', projectId: 'p1', status: 'unread', savedAt: 1 }],
    laterOnProjects: [{ id: 'p1', name: 'Archive fixture', archived: true }],
    laterOnSettings: {}, laterOnFilter: 'all', laterOnFilterChosen: true, laterOnActiveProject: 'all'
  };
  const cache = new Map();
  Object.defineProperty(w, "localStorage", { value: { getItem: k => cache.get(k) ?? null, setItem: (k,v) => cache.set(k,v), removeItem: k => cache.delete(k) } });
  const listeners = [];
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.chrome = {
    storage: { local: {
      async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return clone(Object.fromEntries(names.filter(k => k in store).map(k => [k, store[k]]))); },
      async set(patch) { const changes = {}; for (const [k,v] of Object.entries(patch)) { changes[k] = { oldValue: clone(store[k] ?? null), newValue: clone(v) }; store[k] = clone(v); } listeners.forEach(f => f(changes, 'local')); }
    }, onChanged: { addListener(f) { listeners.push(f); } } },
    tabs: { query: async () => [], getCurrent: async () => ({id:1,windowId:1}), onUpdated: {addListener(){}}, onActivated: {addListener(){}} },
    runtime: { getURL: p => `chrome-extension://fixture/${p}`, sendMessage: async () => ({ok:false}), onMessage: {addListener(){}} },
    windows: {getCurrent: async () => ({id:1})}
  };
  require('./helpers/item-mutation')(w);
  for (const file of ['i18n.js','dialog.js','picker-ui.js','url-utils.js','tab-navigation.js',page === 'library' ? 'library-page.js' : page+'.js']) w.eval(read(file));
  return { dom, w, store, errors, cache };
}
async function search(ctx) {
  const input = ctx.w.document.querySelector('#searchInput');
  input.value = 'archive needle';
  input.dispatchEvent(new ctx.w.Event('input', {bubbles:true}));
  await wait(250);
}
(async () => {
  const panel = mount('sidepanel'), library = mount('library');
  try {
    await wait(100);
    await search(panel); await search(library);
    assert(!panel.w.document.querySelector('.item[data-id="a"]'), '侧栏普通搜索隐藏归档');
    assert(!library.w.document.querySelector('.card[data-id="a"]'), '全屏普通搜索隐藏归档');
    library.w.document.querySelector('#openArchive').click(); await search(library);
    assert(library.w.document.querySelector('.card[data-id="a"]'), '归档视图可以搜索归档资料');
    for (const ctx of [panel, library]) {
      await ctx.w.chrome.storage.local.set({laterOnProjects:[{id:'p1',name:'Archive fixture',archived:false}]});
      if (ctx === library) ctx.w.document.querySelector('.project-nav[data-project="all"]').click();
      await search(ctx);
    }
    assert(panel.w.document.querySelector('.item[data-id="a"]'), '恢复后侧栏普通搜索显示');
    assert(library.w.document.querySelector('.card[data-id="a"]'), '恢复后全屏普通搜索显示');
    await panel.w.chrome.storage.local.set({laterOnProjects:[{id:'p1',name:'Archive fixture',archived:true}]});
    await wait(400);
    assert(!panel.w.document.querySelector('.item[data-id="a"]'), '打开侧栏期间归档也立即隐藏');
    assert.deepStrictEqual(JSON.parse(panel.cache.get('laterOnPanelCache')), [], '侧栏首屏缓存也不保留归档网页');
    assert.deepStrictEqual([...panel.errors,...library.errors], []);
    console.log('PASS 归档普通搜索隐藏、归档视图搜索、恢复及侧栏实时归档');
  } finally { panel.dom.window.close(); library.dom.window.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
