// Render an image-free backup through the real library and sidepanel pages.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = require("./helpers/read-runtime.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const context = vm.createContext({ URL });
vm.runInContext(read('backup-core.js'), context);
const core = context.LaterOnBackup;
const image = 'data:image/png;base64,AAAA';
const source = {
  laterOnItems: [{ id: 'a', url: 'https://example.com/a', title: 'Article', savedAt: 1,
    projectId: 'p', image: 'local://a', favicon: image, status: 'reading' }],
  laterOnProjects: [{ id: 'p', name: 'Project', createdAt: 1, cover: image, coverPick: ['a'] }],
  laterOnCovers: { a: image }
};
const exported = core.create(source, '1', '2026-10-21T01:00:00Z');
const restored = clone(core.toStorage(core.parse(exported)));

async function checkPage(page) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  virtualConsole.on('error', error => errors.push(String(error)));
  const dom = new JSDOM(read(`${page}.html`), { runScripts: 'outside-only', pretendToBeVisual: true,
    url: `chrome-extension://lateron/${page}.html`, virtualConsole });
  const { window } = dom;
  window.fetch = async () => ({});
  const document = window.document;
  const store = { ...clone(restored), laterOnActiveProject: 'p', laterOnFilter: 'all', laterOnFilterChosen: true };
  const listeners = [];
  const memory = new Map();
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key)
  } });
  const event = () => ({ addListener() {} });
  window.scrollTo = () => {};
  window.chrome = {
    storage: { local: {
      async get(keys) { return clone(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))); },
      async set(patch) { Object.assign(store, clone(patch)); }
    }, onChanged: { addListener: listener => listeners.push(listener) } },
    tabs: { query: async () => [{ id: 1, windowId: 1 }], getCurrent: async () => ({ id: 1, windowId: 1 }),
      onActivated: event(), onUpdated: event() },
    windows: { getCurrent: async () => ({ id: 1 }) },
    runtime: { getURL: name => `chrome-extension://lateron/${name}`, sendMessage: async () => ({ ok: false }), onMessage: event() }
  };
  try {
    for (const name of ['url-utils.js', 'tab-navigation.js', 'i18n.js', 'dialog.js', 'storage-client.js', 'item-edit.js', 'item-state.js', 'collection-filter.js', (page === "library" ? "library-page.js" : `${page}.js`)]) window.eval(read(name));
    const itemSelector = page === 'library' ? '.board-card[data-project="p"]' : '.item[data-id="a"]';
    for (let attempt = 0; attempt < 100 && !document.querySelector(itemSelector); attempt++) await tick();
    assert(document.querySelector(itemSelector), `${page} renders the restored collection`);
    if (page === 'library') {
      assert(require('./helpers/is-placeholder.cjs')(document.querySelector('.board-placeholder')));
      assert.equal(document.querySelector('.project-thumb .project-ph')?.textContent, 'P');
      document.querySelector('.board-card[data-project="p"]').click();
      for (let attempt = 0; attempt < 100 && !document.querySelector('.card[data-id="a"]'); attempt++) await tick();
      assert.equal(new URL(document.querySelector('.card[data-id="a"] .cover-logo').src).pathname, '/article-cover-placeholder.png');
      assert.equal(document.querySelector('.card[data-id="a"] .cover-img'), null);
      const changedProjects = clone(store.laterOnProjects);
      changedProjects[0].cover = 'https://example.com/unavailable.jpg';
      listeners.forEach(listener => listener({ laterOnProjects: { newValue: changedProjects } }, 'local'));
      document.querySelector('.project-nav[data-project="all"]').click();
      await tick();
      const custom = document.querySelector('.board-card[data-project="p"]');
      custom.querySelector('.board-img').dispatchEvent(new window.Event('error'));
      await tick();
      assert(custom.querySelector('.board-placeholder'), 'failed custom project covers fall back too');
      listeners.forEach(listener => listener({ laterOnProjects: { newValue: clone(store.laterOnProjects) },
        laterOnItems: { newValue: [{ ...store.laterOnItems[0], image: 'https://example.com/unavailable.jpg' }] } }, 'local'));
      await tick();
      const broken = document.querySelector('.board-card[data-project="p"]');
      broken.querySelector('.board-img').dispatchEvent(new window.Event('error'));
      await tick();
      assert(broken.querySelector('.board-placeholder'), 'failed remote images fall back too');
    } else {
      assert.equal(document.querySelector('.item[data-id="a"] .thumb-logo')?.getAttribute('src'), 'article-cover-placeholder.png');
      assert.equal(document.querySelector('.item[data-id="a"] .thumb-img'), null);
    }
    // Exercise the actual image error handlers in both page entries.
    if (page === 'library') {
      document.querySelector('.project-nav[data-project="p"]').click();
      await tick();
    }
    const video = 'https://i.ytimg.com/vi/fixture/';
    listeners.forEach(listener => listener({ laterOnItems: { newValue: [{ ...store.laterOnItems[0], image: `${video}maxresdefault.jpg` }] } }, 'local'));
    await tick();
    const imageSelector = page === 'library' ? '.card .cover-img' : '.item .thumb-img';
    for (const file of ['hq720.jpg', 'hqdefault.jpg', 'mqdefault.jpg']) {
      document.querySelector(imageSelector).dispatchEvent(new window.Event('error'));
      await tick();
      assert.equal(document.querySelector(imageSelector).src, `${video}${file}`, `${page} retries the next YouTube image`);
    }
    document.querySelector(imageSelector).dispatchEvent(new window.Event('error'));
    await tick();
    assert.equal(document.querySelector(imageSelector), null, `${page} stops retrying after the last fallback`);
    assert.deepEqual(errors, []);
  } finally { window.close(); }
}

(async () => {
  await checkPage('library');
  await checkPage('sidepanel');
  console.log('PASS image-free backup displays default covers in library, project boards and sidepanel');
})().catch(error => { console.error(error); process.exitCode = 1; });
