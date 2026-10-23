// 生成「图板视图」的设计预览页：真实 WXT 收藏库产物，包含编译后的 Vue 组件，
// 只把 chrome.storage 换成一份假数据（几个类目、带封面的收藏），打开就是图板视图。
// 这样预览看到的就是当前那份实现，不会和代码脱节（改完重跑一次本脚本即可）。
//
// 用法：node tests/build-board-preview.js
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const ROOT = path.join(dir, "..");
const OUTPUT = path.join(dir, "board-preview.html");

const mock = () => {
  // 预览用的假封面：直接用 SVG data URI，不依赖网络，离线也能看到拼图效果。
  const svgCover = (from, to, label) =>
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="600" height="400" fill="url(#g)"/>` +
      `<text x="300" y="225" font-size="70" text-anchor="middle" fill="rgba(255,255,255,.92)" ` +
      `font-family="system-ui, sans-serif">${label}</text></svg>`
    );
  const now = Date.now();
  const day = 86400000;
  const item = (id, extra) => ({
    id, title: `标题 ${id}`, description: "这是自动抓取来的一段摘要，用来看看排版长什么样。",
    image: "", favicon: "", source: "少数派", url: `https://example.com/${id}`,
    savedAt: now, read: false, ...extra
  });
  window.chrome = {
    storage: {
      local: {
        get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return Promise.resolve(out);
        },
        set(patch) {
          const changes = {};
          for (const [key, value] of Object.entries(patch)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          window.setTimeout(() => listeners.forEach((fn) => fn(changes, "local")), 0);
          return Promise.resolve();
        }
      },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    },
    tabs: { query: () => Promise.resolve([{ id: 1, windowId: 1 }]) },
    // library.js 一开头就挂了 runtime.onMessage（全屏页收到通知时弹 toast），
    // 这里必须给出空实现，否则预览页在初始化第一步就抛 addListener of undefined、整页空白。
    runtime: { getURL: (p) => `chrome-extension://lateron/${p}`, onMessage: { addListener() {} } }
  };
  const listeners = [];
  const store = {
    laterOnItems: [
      item("e1", { title: "把一天切成三块：我用了半年的时间管理法", source: "少数派", projectId: "eff", image: svgCover("#ff9a6c", "#ff5c35", "1") }),
      item("e2", { title: "为什么你的待办清单总是做不完", source: "知乎", projectId: "eff", savedAt: now - day, image: svgCover("#6cc4ff", "#2f6bff", "2") }),
      item("e3", { title: "深度工作的四个前提", source: "少数派", projectId: "eff", savedAt: now - 2 * day, image: svgCover("#8ad6a5", "#1f9c63", "3") }),
      item("e4", { title: "会议减半之后发生了什么", source: "虎嗅", projectId: "eff", savedAt: now - 3 * day, read: true }),
      item("i1", { title: "2026 年的界面设计趋势", source: "站酷", projectId: "insp", image: svgCover("#c58bff", "#7b3fe4", "4") }),
      item("i2", { title: "一套好用的配色方法", source: "Dribbble", projectId: "insp", savedAt: now - day, image: svgCover("#ffd36c", "#ff8a3d", "5") }),
      item("i3", { title: "留白不是偷懒", source: "站酷", projectId: "insp", savedAt: now - 4 * day, image: svgCover("#7ef0e0", "#1aa39a", "6") }),
      item("l1", { title: "一篇两万字的长报道", source: "三联生活周刊", projectId: "long", image: svgCover("#ff8fa8", "#e0366b", "7") }),
      item("u1", { title: "还没归类的收藏", source: "B站", projectId: null, image: svgCover("#9aa4ff", "#4b56d6", "8") }),
      item("u2", { title: "另一篇还没归类的", source: "豆瓣", projectId: null, savedAt: now - 5 * day })
    ],
    laterOnProjects: [
      { id: "eff", name: "工作效率", note: "关于怎么把时间花在真正重要的事上。", createdAt: 1 },
      // 「设计灵感」带着 coverPick：预览页一打开就能看到「自己挑的封面组合」长什么样
      // （i3 最新排第一，i1 第二 —— 挑的顺序说了算，不是按时间）。
      { id: "insp", name: "设计灵感", createdAt: 2, coverPick: ["i3", "i1"] },
      // 「读不完的长文」带着 pinned：预览页一打开就能看到侧栏的置顶（图钉角标 + 分隔线）长什么样。
      { id: "long", name: "读不完的长文", createdAt: 3, pinned: true },
      { id: "later", name: "稍后整理", createdAt: 4 }
    ],
    laterOnActiveProject: "all",
    laterOnOnboardingSeen: true,
    // 打开就落在图板视图；深色背景看拼图更清楚（theme.js 会读这份设置）
    laterOnSettings: { libraryView: "boards", theme: "dark" }
  };
  window.__laterOnPreview = { store, svgCover };
};

// Inline the actual WXT output, including compiled Vue components, for offline preview.
const { JSDOM } = require("jsdom");
const read = require("./helpers/read-runtime.cjs");
const page = require("./helpers/library-page.cjs")();
const built = path.join(ROOT, ".output/chrome-mv3");
const dom = new JSDOM(page.html);
const { document } = dom.window;
const imageData = name => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, name)).toString("base64")}`;
const scriptElement = (code) => {
  const element = document.createElement("script");
  element.textContent = code.replace(/<\/script>/gi, "<\\/script>");
  return element;
};
// Mock the extension boundary before theme initialization.
document.head.prepend(scriptElement(`(${mock.toString()})();`));
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) link.remove();
for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
  const style = document.createElement("style");
  style.textContent = fs.readFileSync(path.join(built, new URL(link.href, "https://fixture/").pathname), "utf8");
  link.replaceWith(style);
}
for (const script of document.querySelectorAll("script[src]")) {
  if (script.type === "module") script.remove();
  else script.replaceWith(scriptElement(read(path.basename(script.src))));
}
// Execute the module after its Teleport targets exist.
const previewScript = fs.readdirSync(path.join(built, "assets")).filter(name => name.endsWith(".png")).reduce((script, name) =>
  script.replaceAll(`/assets/${name}`, `data:image/png;base64,${fs.readFileSync(path.join(built, "assets", name)).toString("base64")}`), page.script);
document.body.append(scriptElement(previewScript));
const images = [
  ...document.querySelectorAll("img[src], link[rel=icon]"),
  ...[...document.querySelectorAll("template")].flatMap(template => [...template.content.querySelectorAll("img[src]")])
];
for (const image of images) {
  const attribute = image.tagName === "IMG" ? "src" : "href";
  const file = path.basename(image.getAttribute(attribute));
  image.setAttribute(attribute, imageData(file));
}
const base = document.createElement("base");
base.href = "../";
document.head.prepend(base);
fs.writeFileSync(OUTPUT, dom.serialize());
dom.window.close();
console.log(`已生成 ${path.relative(process.cwd(), OUTPUT)}`);
