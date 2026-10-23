// Exercise the real library controller: drag, cancellation, bounds, persistence and alternatives.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

async function fixture(savedWidth, failWrites = false) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(require("./helpers/read-runtime.cjs")("library.html"), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'chrome-extension://fixture/library.html', virtualConsole
  });
  const { window } = dom;
  const store = {
    laterOnItems: [], laterOnProjects: [{ id: 'long', name: 'Codex研究和探索以及更多长期学习资料', createdAt: 1 }],
    laterOnSettings: {}, laterOnSidebarWidth: savedWidth
  };
  const listeners = [];
  const writes = [];
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]]));
        },
        async set(patch) {
          writes.push(patch);
          if (failWrites) throw new Error('disk unavailable');
          const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) =>
            [key, { oldValue: store[key], newValue }]));
          Object.assign(store, patch);
          listeners.forEach(listener => listener(changes, 'local'));
        }
      },
      onChanged: { addListener: listener => listeners.push(listener) }
    },
    tabs: { query: async () => [{ id: 1, windowId: 1 }] },
    runtime: { onMessage: { addListener() {} }, getURL: name => name }
  };
  window.eval(read('i18n.js'));
  require('./helpers/item-mutation')(window);
  window.eval(require("./helpers/read-runtime.cjs")("library-page.js"));
  await tick();
  const { document } = window;
  const handle = document.querySelector('#sidebarResizer');
  let captured = null;
  handle.setPointerCapture = id => { captured = id; };
  handle.hasPointerCapture = id => captured === id;
  handle.releasePointerCapture = () => { captured = null; };
  const pointer = (type, x, pointerId = 1) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    handle.dispatchEvent(event);
  };
  const key = (value, shiftKey = false) => handle.dispatchEvent(new window.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: value, shiftKey
  }));
  const width = () => Number(handle.getAttribute('aria-valuenow'));
  const resize = value => { window.innerWidth = value; window.dispatchEvent(new window.Event('resize')); };
  return { dom, window, document, store, writes, errors, handle, pointer, key, width, resize };
}

(async () => {
  const f = await fixture(320);
  const { document, handle, pointer, key, width } = f;
  assert.equal(width(), 320, 'restore saved width');
  assert.equal(document.querySelector('.project-nav[data-project="long"]').getAttribute('aria-label'),
    f.store.laterOnProjects[0].name, 'full name is available to keyboard and screen reader users');
  pointer('pointerdown', 320);
  pointer('pointermove', 380, 2);
  assert.equal(width(), 320, 'ignore other pointers');
  pointer('pointermove', 380);
  assert.equal(width(), 380, 'live drag');
  assert.equal(f.writes.length, 0, 'do not write on every movement');
  pointer('pointerup', 380);
  assert.equal(f.store.laterOnSidebarWidth, 380, 'persist on release');
  handle.click();
  assert.equal(document.querySelector('#sidebarSizeControls').hidden, true, 'drag does not open the controls');
  pointer('pointerdown', 380);
  pointer('pointermove', 800);
  assert.equal(width(), 420, 'clamp at maximum');
  key('Escape');
  assert.equal(width(), 380, 'Escape restores width before drag');
  assert.equal(document.body.classList.contains('is-resizing-sidebar'), false);
  pointer('pointerdown', 380);
  pointer('pointermove', 100);
  assert.equal(width(), 240, 'clamp at minimum');
  pointer('pointercancel', 100);
  assert.equal(width(), 380, 'cancelled pointer restores width');
  pointer('pointerdown', 380);
  pointer('pointermove', 400);
  handle.dispatchEvent(new f.window.Event('lostpointercapture'));
  assert.equal(width(), 380, 'lost capture cancels cleanly');
  key('ArrowRight');
  assert.equal(width(), 388);
  key('ArrowLeft', true);
  assert.equal(width(), 356);
  key('Home');
  assert.equal(width(), 240);
  key('End');
  assert.equal(width(), 420);
  f.resize(700);
  assert.equal(width(), 340, 'reserve content space on a narrow window');
  assert.equal(f.store.laterOnSidebarWidth, 420, 'viewport changes do not overwrite preference');
  f.resize(1200);
  assert.equal(width(), 420, 'restore preference when viewport grows');
  key('Enter');
  assert.equal(width(), 280, 'Enter resets');
  pointer('pointerdown', 280);
  pointer('pointerup', 280);
  handle.click();
  assert.equal(document.querySelector('#sidebarSizeControls').hidden, false, 'click offers a non-drag alternative');
  document.querySelector('[data-sidebar-size="wider"]').click();
  assert.equal(width(), 304);
  document.querySelector('[data-sidebar-size="narrower"]').click();
  assert.equal(width(), 280);
  document.querySelector('[data-sidebar-size="reset"]').click();
  assert.equal(width(), 280);
  f.resize(600);
  pointer('pointerdown', 280);
  pointer('pointermove', 500);
  assert.equal(document.body.classList.contains('is-resizing-sidebar'), false, 'no resizing in mobile layout');
  f.resize(1200);
  await f.window.chrome.storage.local.set({ laterOnSidebarWidth: 360 });
  assert.equal(width(), 360, 'other library windows stay in sync');
  const reopened = await fixture(f.store.laterOnSidebarWidth);
  assert.equal(reopened.width(), 360, 'new library instance restores last width');
  reopened.dom.window.close();
  assert.deepEqual(f.errors, []);
  f.dom.window.close();
  for (const invalid of [undefined, null, '300', -10, NaN, Infinity, 9999]) {
    const next = await fixture(invalid);
    assert.ok(next.width() >= 240 && next.width() <= 420, 'bad stored values cannot break layout');
    next.dom.window.close();
  }
  const failing = await fixture(280, true);
  failing.key('ArrowRight');
  await tick();
  assert.equal(failing.width(), 288, 'storage failure leaves the current resize usable');
  assert.deepEqual(failing.errors, []);
  failing.dom.window.close();
  console.log('Sidebar resize: drag, cancellation, bounds, keyboard, click controls and persistence passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
