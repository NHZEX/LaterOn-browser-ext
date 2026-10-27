// 主题（浅色 / 深色）在各界面之间的同步测试。覆盖：
// 真正执行 theme.js，验证设置切换实时更新页面；布局与主题颜色由 Chromium 验证。
const { JSDOM, VirtualConsole } = require("jsdom");

const themeSource = require("./helpers/read-runtime.cjs")("theme.js");

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  → " + extra : ""}`);
  if (!ok) failures += 1;
};

console.log("── 把设置切成深色 → 侧栏真的变深色 ──");
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(String(error?.message || error)));
const dom = new JSDOM(require("./helpers/read-runtime.cjs")("sidepanel.html"), {
  runScripts: "outside-only",
  url: "chrome-extension://lateron/sidepanel.html",
  virtualConsole
});
const { window } = dom;

const store = { laterOnSettings: { theme: "dark", defaultSort: "newest" } };
const changeListeners = [];
window.chrome = {
  storage: {
    local: {
      get: (key) => Promise.resolve({ [key]: store[key] }),
      set: (patch) => {
        const changes = {};
        for (const [key, value] of Object.entries(patch)) {
          changes[key] = { oldValue: store[key], newValue: value };
          store[key] = value;
        }
        changeListeners.forEach((fn) => fn(changes, "local"));
        return Promise.resolve();
      }
    },
    onChanged: { addListener(fn) { changeListeners.push(fn); } }
  }
};

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  window.eval(themeSource);
  await tick();
  const theme = () => window.document.documentElement.dataset.theme;
  check("设置是 dark 时，侧栏 <html> 带上 data-theme=\"dark\"", theme() === "dark", `实际=${theme()}`);

  console.log("\n── 第 4 步：改设置实时同步，不用重开侧栏 ──");
  await window.chrome.storage.local.set({ laterOnSettings: { ...store.laterOnSettings, theme: "light" } });
  await tick();
  check("切成 light 后，侧栏立刻跟着变浅色", theme() === "light", `实际=${theme()}`);

  await window.chrome.storage.local.set({ laterOnSettings: { ...store.laterOnSettings, theme: "dark" } });
  await tick();
  check("再切回 dark，侧栏又跟着变深色", theme() === "dark", `实际=${theme()}`);

  console.log("\n── 第 5 步：全程没有未捕获的错误 ──");
  check("没有 jsdom 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(`\n${failures === 0 ? "全部通过" : "存在失败"}：${failures === 0 ? "没有失败项" : failures + " 项失败"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
