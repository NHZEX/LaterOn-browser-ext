const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const urlSource = fs.readFileSync(path.join(ROOT, "url-utils.js"), "utf8");
const navigationSource = fs.readFileSync(path.join(ROOT, "tab-navigation.js"), "utf8");
const librarySource = fs.readFileSync(path.join(ROOT, "library.js"), "utf8");
const sidepanelSource = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");

const tabs = [
  { id: 1, windowId: 10, active: true, url: "chrome-extension://lateron/library.html" },
  { id: 2, windowId: 20, active: false, url: "https://www.example.com/article/?utm_source=mail&a=1#part-3" },
  { id: 3, windowId: 30, active: true, pendingUrl: "https://other.test/reading" }
];
const tabUpdates = [];
const windowUpdates = [];
const context = vm.createContext({
  URL,
  globalThis: {},
  chrome: {
    tabs: {
      query: async () => tabs,
      update: async (id, patch) => { tabUpdates.push({ id, patch }); return { id, ...patch }; }
    },
    windows: {
      update: async (id, patch) => { windowUpdates.push({ id, patch }); return { id, ...patch }; }
    }
  }
});
context.globalThis = context;
vm.runInContext(urlSource, context, { filename: "url-utils.js" });
vm.runInContext(navigationSource, context, { filename: "tab-navigation.js" });

(async () => {
  const match = await context.LaterOnTabs.findOpen("https://example.com/article?a=1");
  assert.strictEqual(match?.id, 2, "应忽略 www、追踪参数、末尾斜杠和页内锚点");

  await context.LaterOnTabs.activate(match);
  assert.strictEqual(JSON.stringify(tabUpdates.at(-1)), JSON.stringify({ id: 2, patch: { active: true } }));
  assert.strictEqual(JSON.stringify(windowUpdates.at(-1)), JSON.stringify({ id: 20, patch: { focused: true } }));

  const pendingMatch = await context.LaterOnTabs.findOpen("https://other.test/reading#resume");
  assert.strictEqual(pendingMatch?.id, 3, "尚在加载的标签页也应复用");

  const excluded = await context.LaterOnTabs.findOpen("https://example.com/article?a=1", { excludeTabId: 2 });
  assert.strictEqual(excluded, null, "全屏收藏库可排除自身标签页");

  tabs.push({ id: 4, windowId: 10, active: true, url: "https://www.youtube.com/watch?v=ss-ufzKALnI&list=WL&index=23&t=15s" });
  tabs.push({ id: 5, windowId: 20, active: false, url: "https://www.youtube.com/watch?v=SS-ufzKALnI" });
  for (const target of ["https://youtu.be/ss-ufzKALnI?si=shared", "https://www.youtube.com/watch?v=ss-ufzKALnI"]) {
    for (let click = 0; click < 3; click++) {
      const videoTab = await context.LaterOnTabs.findOpen(target);
      assert.strictEqual(videoTab?.id, 4, "重复点击同一视频应复用当前标签页，忽略时间和播放列表参数");
      await context.LaterOnTabs.activate(videoTab);
      assert.strictEqual(tabUpdates.at(-1).id, 4);
    }
  }
  assert.strictEqual((await context.LaterOnTabs.findOpen("https://youtu.be/SS-ufzKALnI"))?.id, 5, "不同视频不能误复用");

  const original = "https://suspended.test/a%2Fb?q=C++&part=2#section";
  tabs.push({ id: 6, windowId: 40, active: false, url: `chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Test&pos=300&uri=${original}` });
  const suspended = await context.LaterOnTabs.findOpen(original);
  assert.strictEqual(suspended?.id, 6, "已有冻结页按原网址匹配");
  await context.LaterOnTabs.activate(suspended);
  assert.strictEqual(tabUpdates.at(-1).id, 6);
  assert.strictEqual(JSON.stringify(tabUpdates.at(-1).patch), JSON.stringify({ active: true }), "只聚焦冻结页，不强制导航或恢复");
  assert.strictEqual((await context.LaterOnTabs.findOpen("https://suspended.test/a%2Fb?q=C++&part=3")), null, "不同参数不能误复用");

  tabs.push({ id: 7, windowId: 10, active: false, url: "https://routes.test/app#/article/1?b=2&a=1" });
  tabs.push({ id: 8, windowId: 20, active: false, url: "https://routes.test/app#/article/2?a=1&b=2" });
  assert.strictEqual((await context.LaterOnTabs.findOpen("https://routes.test/app#/article/1?a=1&b=2"))?.id, 7);
  assert.strictEqual((await context.LaterOnTabs.findOpen("https://routes.test/app#/article/2?b=2&a=1"))?.id, 8, "不同 hash 页面不能激活错误标签");
  assert.strictEqual(await context.LaterOnTabs.findOpen("https://routes.test/app#!/article/1?a=1&b=2"), null);
  const frozenRoute = "https://routes.test/app#/article/3?q=C++&part=2";
  tabs.push({ id: 9, windowId: 40, active: false, url: `chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Route&pos=0&uri=${frozenRoute}` });
  assert.strictEqual((await context.LaterOnTabs.findOpen("https://routes.test/app#/article/3?part=2&q=C++"))?.id, 9);

  assert.match(librarySource, /LaterOnTabs\.findOpen\(target, \{ excludeTabId: libraryTabId \}\)/);
  assert.match(sidepanelSource, /LaterOnTabs\.findOpen\(target\)/);
  console.log("PASS 已打开页面会被复用并聚焦其窗口");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
