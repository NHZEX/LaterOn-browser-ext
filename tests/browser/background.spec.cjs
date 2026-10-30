const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { test, expect, buildDir } = require("./extension.cjs");

test("原生后台冷启动可抓取、保存、更新和导出，无全局桥接", { tag: "@smoke" }, async ({ context, extension }) => {
  const errors = [];
  extension.worker.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  expect(await extension.worker.evaluate(() =>
    ["LaterOnUrl", "LaterOnCollection", "LaterOnBackup", "LaterOnPicker"].filter(name => name in globalThis))).toEqual([]);
  await context.route("https://f2.test/**", route => route.fulfill({ contentType: "text/html", body:
    '<title>Native worker article</title><meta property="og:title" content="Native worker article"><meta property="og:description" content="Captured by the native worker"><meta property="og:image" content="https://f2.test/cover.png"><p>Article</p>' }));
  const article = await context.newPage();
  await article.goto("https://f2.test/article");
  const tabId = await extension.worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === "https://f2.test/article").id);
  const page = await context.newPage();
  await page.goto(extension.url.replace("sidepanel.html", "save-project-picker.html"));
  const saved = await page.evaluate(tabId => chrome.runtime.sendMessage({ type: "QUICK_SAVE_TAB", tabId }), tabId);
  expect(saved.ok).toBe(true);
  const backup = await page.evaluate(() => chrome.runtime.sendMessage({ type: "BACKUP_EXPORT" }));
  expect(backup.ok).toBe(true);
  expect(backup.payload.data.items).toHaveLength(1);
  const item = backup.payload.data.items[0];
  expect(item.title).toBe("Native worker article");
  expect(item.description).toBe("Captured by the native worker");
  const changed = await page.evaluate(id => chrome.runtime.sendMessage({ type: "COLLECTION_COMMAND", epoch: "",
    action: "mutateItems", operation: "update", ids: [id], patch: { status: "reading" } }), item.id);
  expect(changed.ok).toBe(true);
  const position = await page.evaluate(id => chrome.runtime.sendMessage({ type: "SAVE_READING_POSITION", itemId: id, y: 456 }), item.id);
  expect(position.ok).toBe(true);
  expect(await extension.worker.evaluate(async () => {
    const data = await chrome.storage.local.get(["laterOnItems", "laterOnReadingPositions"]);
    return { status: data.laterOnItems[0].status, y: data.laterOnReadingPositions[data.laterOnItems[0].id] };
  })).toEqual({ status: "reading", y: 456 });
  expect(errors).toEqual([]);
});

test("浏览器重启后原生后台保留收藏并接受重启前的备份预览", async () => {
  const root = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(root, "stayside-browser-restart-"));
  let context;
  const launch = () => chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`] });
  const connect = async () => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/save-project-picker.html`);
    return { page, worker };
  };
  try {
    context = await launch();
    let { page, worker } = await connect();
    await worker.evaluate(() => chrome.storage.local.set({ laterOnCleanupV165: true, laterOnSettings: { autoCleanEnabled: false } }));
    const saved = await page.evaluate(() => chrome.runtime.sendMessage({ type: "SAVE_ITEM",
      item: { title: "Before restart", url: "https://restart.test/article", description: "Saved", image: "" } }));
    expect(saved.ok).toBe(true);
    const exported = await page.evaluate(() => chrome.runtime.sendMessage({ type: "BACKUP_EXPORT" }));
    const payload = exported.payload;
    payload.data.items[0].title = "Restored after restart";
    const preview = await page.evaluate(payload => chrome.runtime.sendMessage({ type: "BACKUP_PREVIEW", mode: "replace", payload }), payload);
    expect(preview.ok).toBe(true);
    await context.close();
    context = await launch();
    ({ page, worker } = await connect());
    expect(await worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems[0].title)).toBe("Before restart");
    const applied = await page.evaluate(({ token, payload }) => chrome.runtime.sendMessage({ type: "BACKUP_APPLY", mode: "replace", token, payload }),
      { token: preview.token, payload });
    expect(applied.ok).toBe(true);
    expect(await worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems[0].title)).toBe("Restored after restart");
  } finally {
    await context?.close();
    const relative = path.relative(root, profile);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Unexpected browser profile path");
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
