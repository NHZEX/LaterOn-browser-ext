// Execute the actual WXT injection bundle; mock only the Chrome boundary.
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const source = require("./helpers/read-runtime.cjs")("content-folder-picker.js");
const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

function boot(sendMessage) {
  const dom = new JSDOM("<!doctype html><body><video></video></body>", {
    url: "https://example.com/article", runScripts: "outside-only", pretendToBeVisual: true
  });
  const { window } = dom;
  const messages = [];
  window.chrome = { runtime: {
    getURL: file => `chrome-extension://lateron/${file}`,
    sendMessage: message => { messages.push(message); return sendMessage(message); }
  } };
  const payload = (batchId, theme = "light") => {
    const node = window.document.createElement("script");
    node.id = "lateron-picker-payload-data";
    node.type = "application/json";
    node.textContent = JSON.stringify({ batchId, theme, selected: "work",
      folders: [{ id: "work", name: batchId, count: 1 }], pages: [] });
    window.document.documentElement.append(node);
  };
  return { dom, window, messages, payload,
    inject: () => window.eval(source),
    shadow: () => window.document.getElementById("lateron-folder-picker")?.shadowRoot };
}

(async () => {
  const app = boot(async () => ({ ok: true }));
  try {
    const video = app.window.document.querySelector("video");
    Object.defineProperty(video, "paused", { get: () => false });
    let resumes = 0;
    video.play = async () => { resumes += 1; };
    app.payload("first");
    app.inject();
    app.payload("second", "dark");
    assert.doesNotThrow(app.inject, "同一网页重复注入不能重复声明顶层变量");
    assert.equal(app.window.document.querySelectorAll("#lateron-folder-picker").length, 1);
    assert.match(app.shadow().querySelector(".lon-primary").textContent, /second/);
    assert.equal(app.shadow().querySelector(".lon-root").dataset.dark, "1");
    video.dispatchEvent(new app.window.Event("pause"));
    assert.equal(resumes, 1, "替换浮层应同时清理旧实例的播放守卫");
    app.window.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    assert.deepEqual(app.messages.map(message => [message.type, message.batchId]), [["CONFIRM_BATCH_SAVE", "second"]],
      "替换浮层后键盘只提交当前批次");
    assert.equal(app.window.openFolderPicker, undefined);
    assert.equal(app.window.showFolderPickerOverlay, undefined);
  } finally { app.dom.window.close(); }

  const waiting = boot(async () => ({ ok: true }));
  try {
    waiting.inject();
    waiting.inject();
    waiting.payload("late");
    waiting.window.document.dispatchEvent(new waiting.window.CustomEvent("lateron-picker-payload-ready"));
    assert.ok(waiting.shadow(), "UI 先到、配置后到时仍能打开浮层");
    assert.equal(waiting.window.document.getElementById("lateron-picker-payload-data"), null);
    waiting.shadow().querySelector(".lon-ghost").click();
    await tick();
    assert.deepEqual(waiting.messages.map(message => [message.type, message.batchId]), [["CANCEL_BATCH_SAVE", "late"]]);
  } finally { waiting.dom.window.close(); }

  for (const sendMessage of [
    () => { throw new Error("Extension context invalidated"); },
    () => Promise.reject(new Error("Extension context invalidated"))
  ]) {
    const app = boot(sendMessage);
    try {
      app.payload("expired-runtime");
      app.inject();
      const input = app.shadow().querySelector(".lon-new-input");
      input.value = "New project";
      input.dispatchEvent(new app.window.Event("input", { bubbles: true }));
      app.shadow().querySelector(".lon-primary").click();
      await tick();
      assert.equal(app.shadow().querySelector(".lon-summary").textContent, "新建项目失败，请重试。");
      assert.equal(app.shadow().querySelector(".lon-primary").disabled, false);
      input.value = "";
      input.dispatchEvent(new app.window.Event("input", { bubbles: true }));
      app.shadow().querySelector(".lon-primary").click();
      await tick(300);
      assert.equal(app.shadow(), undefined, "失效 runtime 的确认回调可安全退场");
      app.payload("cancel-invalid");
      app.inject();
      app.shadow().querySelector(".lon-ghost").click();
      await tick(300);
      assert.equal(app.shadow(), undefined, "失效 runtime 的取消回调可安全退场");
    } finally { app.dom.window.close(); }
  }
  console.log("PASS 实际 WXT 项目选择入口重复注入、双向配置握手、监听清理及失效 runtime");
})().catch(error => { console.error(error); process.exitCode = 1; });
