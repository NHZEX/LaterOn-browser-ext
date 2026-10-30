const { createHash } = require("node:crypto");
const { test, expect } = require("./extension.cjs");
const keys = ["laterOnItems", "laterOnProjects", "laterOnCovers", "laterOnIcons", "laterOnOrder", "laterOnReadingPositions"];
const pageUrl = (extension, kind) => new URL(kind === "library" ? "library.html?from=sidepanel&project=unfiled&filter=all" : "sidepanel.html", extension.url).href;
const card = (page, kind, id) => page.locator(`${kind === "library" ? ".card" : ".item"}[data-id="${id}"]`);
const favicon = (page, kind, id) => card(page, kind, id).locator(kind === "library" ? "img.favicon" : ".meta img");
async function images(page) {
  return page.evaluate(() => [0, 1, 2, 3].map(seed => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext("2d"), pixels = context.createImageData(32, 32);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = (i * 31 + seed * 71) % 251;
      pixels.data[i + 1] = (i * 13 + seed * 97) % 241;
      pixels.data[i + 2] = (i * 23 + seed * 43) % 239;
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL("image/png");
  }));
}
async function seed(page, extension, values, shared = false) {
  await page.goto(new URL("settings.html", extension.url).href);
  // A queued request settles startup maintenance before fixture data is installed.
  await page.evaluate(async () => {
    const state = await chrome.storage.local.get("laterOnCollectionEpoch");
    await chrome.runtime.sendMessage({ type: "COLLECTION_COMMAND", action: "migrateLegacyData", epoch: state.laterOnCollectionEpoch || "" });
  });
  const hashes = values.map(value => createHash("sha256").update(value).digest("hex"));
  await extension.worker.evaluate(async ({ values, hashes, shared }) => {
    await chrome.storage.local.clear();
    const inline = [9, 2, 1, 2].flatMap((n, group) => Array.from({ length: n }, () => group));
    await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnCleanupV165: true,
      laterOnSettings: { language: "en", theme: "dark", autoCleanEnabled: false, autoMarkRead: false },
      laterOnFilter: "all", laterOnFilterChosen: true, laterOnActiveProject: "unfiled", laterOnProjects: [], laterOnCovers: {},
      laterOnItems: inline.map((group, i) => ({ id: `n-${i}`, title: `Page ${i}`, source: "same.test", description: "Summary", image: "",
        url: `https://same.test/${i}`, savedAt: 1000 - i, status: "unread", read: false, doneAt: null, projectId: null,
        favicon: shared ? `icon://${hashes[group]}` : values[group] })),
      ...(shared ? { laterOnIcons: Object.fromEntries(hashes.map((hash, i) => [hash, values[i]])) } : {}) });
  }, { values, hashes, shared });
  return hashes;
}

for (const kind of ["library", "sidepanel"]) {
  test(`图标去重：${kind} 迁移、真实图片、无广播命令响应和存储减量`, async ({ page, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const values = await images(page);
    await seed(page, extension, values);
    const before = await extension.worker.evaluate(keys => chrome.storage.local.getBytesInUse(keys), keys);
    await page.addInitScript(() => { chrome.storage.onChanged.addListener = () => {}; });
    await page.goto(pageUrl(extension, kind));
    await expect(favicon(page, kind, "n-0")).toHaveAttribute("src", values[0]);
    await expect.poll(() => favicon(page, kind, "n-0").evaluate(img => img.complete && img.naturalWidth)).toBe(32);
    const state = await extension.worker.evaluate(keys => chrome.storage.local.get(keys), keys);
    expect(Object.keys(state.laterOnIcons)).toHaveLength(4);
    expect(state.laterOnItems.every(item => item.favicon.startsWith("icon://"))).toBe(true);
    const after = await extension.worker.evaluate(keys => chrome.storage.local.getBytesInUse(keys), keys);
    expect(after).toBeLessThan(before);

    const saved = await page.evaluate(async favicon => chrome.runtime.sendMessage({ type: "SAVE_ITEM", item: {
      url: "https://same.test/new", title: "New remote icon", favicon, image: "", description: "New summary"
    } }), values[3]);
    expect(saved.ok).toBe(true);
    expect(saved.item.favicon).toBe(state.laterOnItems[13].favicon);
    await card(page, kind, "n-0").locator(".read-toggle").click();
    await expect(favicon(page, kind, saved.item.id)).toHaveAttribute("src", values[3]);
    await expect.poll(() => favicon(page, kind, saved.item.id).evaluate(img => img.complete && img.naturalWidth)).toBe(32);
    expect(await extension.worker.evaluate(async () => Object.keys((await chrome.storage.local.get("laterOnIcons")).laterOnIcons).length)).toBe(4);
    expect(errors).toEqual([]);
  });

  test(`图标去重：${kind} 初始化期间的新列表和图标广播优先于旧快照`, async ({ page, extension }) => {
    const values = await images(page);
    const hashes = await seed(page, extension, values, true);
    await page.addInitScript(() => {
      window.iconRead = { release: null, notified: false };
      chrome.storage.onChanged.addListener(changes => { if (changes.laterOnIcons) window.iconRead.notified = true; });
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async keys => {
        const snapshot = await get(keys);
        if (!Array.isArray(keys) || !keys.includes("laterOnItems") || window.iconRead.release) return snapshot;
        return new Promise(resolve => { window.iconRead.release = () => resolve(snapshot); });
      };
    });
    await page.goto(pageUrl(extension, kind), { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.iconRead.release)).toBe("function");
    await extension.worker.evaluate(async ({ hash, value }) => {
      const { laterOnItems: items } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnItems: [{ ...items[0], title: "Latest page", favicon: `icon://${hash}` }], laterOnIcons: { [hash]: value } });
    }, { hash: hashes[1], value: values[1] });
    await expect.poll(() => page.evaluate(() => window.iconRead.notified)).toBe(true);
    await page.evaluate(() => window.iconRead.release());
    await expect(card(page, kind, "n-0")).toContainText("Latest page");
    await expect(favicon(page, kind, "n-0")).toHaveAttribute("src", values[1]);
    await expect.poll(() => favicon(page, kind, "n-0").evaluate(img => img.complete && img.naturalWidth)).toBe(32);
  });
}

test("图标去重：侧栏缓存只保留首屏所需图标，完整读取等待期间仍显示原图", async ({ page, extension }) => {
  const values = await images(page);
  const hashes = await seed(page, extension, values, true);
  await page.goto(pageUrl(extension, "sidepanel"));
  await expect(favicon(page, "sidepanel", "n-0")).toHaveAttribute("src", values[0]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("laterOnPanelCache") || "null")?.version)).toBe(2);
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem("laterOnPanelCache")));
  expect(cached.items).toHaveLength(12);
  expect(Object.keys(cached.icons).sort()).toEqual(hashes.slice(0, 3).sort());
  await page.addInitScript(() => {
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async keys => {
      const snapshot = await get(keys);
      if (!Array.isArray(keys) || !keys.includes("laterOnItems")) return snapshot;
      return new Promise(resolve => { window.releaseIconRead = () => resolve(snapshot); });
    };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => typeof window.releaseIconRead)).toBe("function");
  await expect(favicon(page, "sidepanel", "n-0")).toHaveAttribute("src", values[0]);
  await expect.poll(() => favicon(page, "sidepanel", "n-0").evaluate(img => img.complete && img.naturalWidth)).toBe(32);
  await page.evaluate(() => window.releaseIconRead());
  await expect(favicon(page, "sidepanel", "n-13")).toHaveAttribute("src", values[3]);
});

test("图标去重：设置页区分使用量与存储份数，缺图提示后仍可导出无图片备份", async ({ page, extension }) => {
  const values = await images(page);
  const hashes = await seed(page, extension, values, true);
  await page.goto(new URL("settings.html", extension.url).href);
  const usage = page.getByRole("region", { name: "Storage usage" });
  await expect(usage).toContainText("Pages with embedded icons: 14");
  await expect(usage).toContainText("Embedded site images stored: 4.");
  const bytes = values.reduce((n, value) => n + Buffer.byteLength(value), 0);
  const expected = `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(bytes / 1024)} KiB`;
  await expect(usage.locator(".storage-breakdown > div").filter({ hasText: "Embedded site icons" }).locator("dd")).toHaveText(expected);
  await extension.worker.evaluate(async hash => {
    const { laterOnIcons: icons } = await chrome.storage.local.get("laterOnIcons");
    delete icons[hash]; await chrome.storage.local.set({ laterOnIcons: icons });
  }, hashes[0]);
  await page.locator("#exportImages").check();
  await page.locator("#exportBtn").click();
  await expect(page.locator(".lod-root:not([hidden])")).toContainText("An embedded site icon is missing.");
  await page.keyboard.press("Escape");
  await page.locator("#exportImages").uncheck();
  const downloaded = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const file = await downloaded;
  const fs = require("node:fs/promises");
  const payload = JSON.parse(await fs.readFile(await file.path(), "utf8"));
  expect(payload.version).toBe(1);
  expect(payload.data.items).toHaveLength(14);
  expect(payload.data.items.every(item => item.favicon === "")).toBe(true);
});
