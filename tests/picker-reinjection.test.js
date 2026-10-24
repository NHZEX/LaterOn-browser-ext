const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "content-folder-picker.js"), "utf8");
const opened = [];
let payload = null;

const context = vm.createContext({
  window: {
    openFolderPicker(options) {
      opened.push(options);
    }
  },
  document: {
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) {
      if (id !== "lateron-picker-payload-data" || !payload) return null;
      const node = {
        textContent: JSON.stringify(payload),
        remove() { payload = null; }
      };
      return node;
    }
  },
  chrome: {
    runtime: {
      sendMessage() { return Promise.resolve({ ok: true }); }
    }
  }
});

payload = { theme: "light", selected: "first", folders: [], pages: [] };
vm.runInContext(source, context, { filename: "content-folder-picker.js" });

payload = { theme: "dark", selected: "second", folders: [], pages: [] };
assert.doesNotThrow(
  () => vm.runInContext(source, context, { filename: "content-folder-picker.js" }),
  "同一个网页第二次注入项目选择脚本不应重复声明顶层变量"
);

assert.strictEqual(opened.length, 2, "每次注入都应打开项目选择框");
assert.strictEqual(opened[0].selected, "first");
assert.strictEqual(opened[1].selected, "second");
assert.strictEqual(opened[1].theme, "dark");

// 扩展重载后 runtime 可能同步抛错或异步拒绝；从实际浮层回调验证安全降级。
(async () => {
  const picker = opened.at(-1);
  for (const sendMessage of [
    () => { throw new Error("Extension context invalidated"); },
    () => Promise.reject(new Error("Extension context invalidated"))
  ]) {
    context.chrome.runtime.sendMessage = sendMessage;
    assert.equal(await picker.onCreateProject("New project"), null);
    assert.equal(await picker.onPick("work"), null);
    assert.equal(await picker.onCancel(), null);
  }
  console.log("PASS 项目选择脚本可重复注入，失效 runtime 的同步及异步错误可恢复");
})().catch(error => { console.error(error); process.exitCode = 1; });
