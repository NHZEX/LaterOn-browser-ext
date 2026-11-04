const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const FakeTimers = require("@sinonjs/fake-timers");
const { showPageNotices } = require("./helpers/load-module.cjs")("src/content/page-notice.ts");

function fixture(prefersDark = false) {
  const dom = new JSDOM("<!doctype html><body><p>Original page</p></body>", { runScripts: "dangerously" });
  const { window } = dom;
  window.matchMedia = () => ({ matches: prefersDark });
  const clock = FakeTimers.withGlobal(window).install();
  // The real function crosses the same serialization boundary as executeScript.
  window.eval(`globalThis.showNotices = (${showPageNotices.toString()})`);
  const show = (items, theme = "light", extra = 0) => window.showNotices(items, extra, `${extra} more added`, theme, "");
  const host = () => window.document.getElementById("lateron-pill-stack");
  const root = () => host()?.shadowRoot.querySelector(".lon-root");
  return { window, clock, show, host, root, close: () => { clock.uninstall(); dom.window.close(); } };
}

{
  const app = fixture();
  try {
    const detail = '<img src=x onerror="alert(1)">';
    app.show([{ text: "Saved", kind: "success", title: "已收藏", detail }]);
    assert.equal(app.root().querySelector(".headline").textContent, "已收藏");
    assert.equal(app.root().querySelector(".detail").textContent, detail);
    assert.equal(app.root().querySelectorAll("img").length, 0, "Saved titles stay literal text");
    assert.equal(app.root().querySelectorAll("svg path").length, 1);
    assert.equal(app.host().getAttribute("aria-live"), "polite");
    app.clock.tick(2000);
    app.show([{ text: "Already added", kind: "skip" }]);
    assert.equal(app.root().children.length, 2);
    app.clock.tick(1320);
    assert.equal(app.root().children.length, 1, "An older notice cannot remove a later one");
    assert.equal(app.root().querySelector(".headline").textContent, "Already added");
    app.clock.tick(2000);
    assert.equal(app.host(), null, "The empty host is removed without animation events");
    assert.equal(app.window.document.body.textContent, "Original page");
  } finally { app.close(); }
}

{
  const app = fixture(true);
  try {
    app.show(Array.from({ length: 10 }, (_, index) => ({ text: `Saved ${index}`, kind: "success" })), "system", 2);
    assert.equal(app.root().dataset.dark, "1");
    assert.equal(app.root().children.length, 6);
    assert.equal(app.root().lastElementChild.querySelector(".headline").textContent, "2 more added");
    app.clock.tick(4300);
    assert.equal(app.host(), null, "Overflow and evicted notices leave no stale stack");
    app.show([{ text: "Failed", kind: "error" }, { text: "Moved", kind: "move" }], "light");
    assert.equal(app.root().dataset.dark, "0");
    assert.deepEqual([...app.root().querySelectorAll(".mark")].map(element => element.textContent), ["!", "↪"]);
    assert.equal(app.root().querySelectorAll("svg").length, 0, "Other statuses do not show a success checkmark");
    app.clock.tick(3500);
    assert.equal(app.host(), null);
  } finally { app.close(); }
}

console.log("PASS serialized page notices: text safety, status icons, stacked lifetimes, overflow and system theme");
