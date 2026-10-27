// Execute the actual WXT outputs; only layout and browser translation APIs are fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

module.exports = async function verifyContentScripts(directory, {
  cancellationTranslator = {}, translationStartTimeoutMs = 5_000
} = {}) {
  const metadata = fs.readFileSync(path.join(directory, "content-metadata.js"), "utf8");
  const translation = fs.readFileSync(path.join(directory, "content-translation.js"), "utf8");
  const reading = fs.readFileSync(path.join(directory, "content-reading-position.js"), "utf8");
  const dom = new JSDOM('<html lang="en"><head><title>First article</title></head><body><article><p>First paragraph with enough text.</p><p>Second paragraph with enough text.</p><p>Third paragraph with enough text.</p></article></body></html>',
    { url: "https://content.test/first", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const plain = value => JSON.parse(JSON.stringify(value));
  try {
    assert.equal(window.eval(metadata).title, "First article", "The injection returns metadata");
    window.history.pushState({}, "", "/second"); window.document.title = "Second article";
    assert.equal(window.eval(metadata).url, "https://content.test/second", "Repeated injection reads the current SPA URL");
    assert.equal(window.eval(metadata).title, "Second article");

    const listeners = new Set();
    window.chrome = { runtime: { onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
      getURL: file => `chrome-extension://fixture/${file}`, sendMessage: async () => ({ ok: true }) } };
    window.eval(reading);
    [...listeners][0]({ type: "LATERON_READING_POSITION_INIT", itemId: "one", y: 900, language: "en" });
    assert.ok(window.document.querySelector("#lateron-reading-position"));
    window.eval(reading);
    assert.equal(listeners.size, 1, "Repeat injection replaces the previous runtime listener");
    assert.equal(window.document.querySelector("#lateron-reading-position"), null, "Repeat injection removes the old prompt");
    window.__laterOnReadingPosition.dispose();
    assert.equal(listeners.size, 0);

    Object.defineProperty(window.HTMLElement.prototype, "innerText", { get() { return this.textContent; } });
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 40 });
    let destroyed = 0;
    window.Translator = { availability: async () => "available", create: async () => ({
      translate: async text => `译文：${text}`, destroy: () => { destroyed += 1; }
    }) };
    const result = plain(await window.eval(translation));
    assert.deepEqual(result, { ok: true, translatedCount: 3, sourceLanguage: "en" }, "The async injection result survives the WXT wrapper");
    assert.equal(window.document.querySelectorAll('[aria-label="中文译文"]').length, 3);
    assert.equal(destroyed, 1);
    assert.deepEqual(plain(await window.eval(translation)), { ok: true, removed: true });
    assert.equal(window.document.querySelectorAll('[aria-label="中文译文"]').length, 0);

    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    window.Translator = { ...window.Translator,
      create: async () => ({ translate: async () => { started(); return pending; }, destroy: () => { destroyed += 1; } }),
      ...cancellationTranslator };
    const first = window.eval(translation);
    let startTimeout;
    try {
      await Promise.race([
        entered,
        Promise.resolve(first).then(result => {
          throw Error(`Translation injection completed before translate started: ${JSON.stringify(result)}`);
        }),
        new Promise((_, reject) => {
          // Keep Node alive until a stalled injection fails, then release this timer on every path.
          startTimeout = setTimeout(() => reject(Error("Timed out waiting for translate to start")), translationStartTimeoutMs);
        })
      ]);
    } finally { clearTimeout(startTimeout); }
    assert.deepEqual(plain(await window.eval(translation)), { ok: true, removed: true });
    release("迟到的译文");
    assert.deepEqual(plain(await first), { ok: true, removed: true });
    assert.equal(window.document.querySelectorAll('[aria-label="中文译文"]').length, 0, "Cancelled work cannot restore translations");
    assert.equal(destroyed, 2);

    // Browser/API boundaries may reject with a cross-realm Error or a plain message object.
    for (const failure of [new Error("Native translation failure"), { message: "Model download failed" }]) {
      window.Translator = { availability: async () => { throw failure; } };
      const rejected = plain(await window.eval(translation));
      assert.deepEqual(rejected, { ok: false, error: failure.message });
      assert.equal(window.document.querySelector("#lateron-translation-status").textContent, failure.message);
    }

    delete window.Translator;
    const unavailable = plain(await window.eval(translation));
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error, /不支持本机网页翻译/);
    assert.equal(window.document.querySelector("#lateron-translation-status").textContent, unavailable.error);
    window.Translator = { availability: async () => "unavailable" };
    const unsupported = plain(await window.eval(translation));
    assert.equal(unsupported.ok, false);
    assert.match(unsupported.error, /暂不支持从 en 翻译为中文/);
  } finally { window.close(); }
};
