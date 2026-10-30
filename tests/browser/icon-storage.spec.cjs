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
  await expect(usage).toContainText("Embedded icons: 14 references · 4 stored");
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

for (const language of ["zh-CN", "en"]) {
  test(`共享图标详情：${language} 折叠、键盘展开、预览和引用数，刷新只读且提示缺失`, async ({ page, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const values = await images(page);
    const hashes = await seed(page, extension, values, true);
    await page.setViewportSize({ width: language === "en" ? 375 : 1360, height: 900 });
    await extension.worker.evaluate(async language => {
      const { laterOnItems: items, laterOnSettings: settings } = await chrome.storage.local.get(["laterOnItems", "laterOnSettings"]);
      await chrome.storage.local.set({ laterOnSettings: { ...settings, language, theme: language === "en" ? "dark" : "light" },
        laterOnItems: items.map((item, i) => ({ ...item, url: `https://${i < 11 ? "linux.do" : i === 11 ? "github.com" : "youtube.com"}/${i}` })) });
    }, language);
    await page.goto(new URL("settings.html", extension.url).href);
    const usage = page.getByRole("region", { name: language === "en" ? "Storage usage" : "存储占用" });
    const summary = usage.locator("summary");
    await expect(usage.locator(".storage-icon-summary")).toHaveText(language === "en"
      ? "Embedded icons: 14 references · 4 stored" : "内嵌图标：14 次引用 · 4 份存储");
    await expect(usage.locator("details")).not.toHaveAttribute("open", "");
    await expect(usage.locator("li")).toHaveCount(0);
    await usage.screenshot({ path: `.output/icon-usage-${language}-collapsed.png`, animations: "disabled" });
    const before = await extension.worker.evaluate(() => chrome.storage.local.get(null));
    await summary.focus(); await page.keyboard.press("Enter");
    const rows = usage.getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText(language === "en" ? "References: 9" : "9 次引用");
    await expect(rows.first()).toContainText("linux.do");
    for (let i = 0; i < 4; i += 1) {
      await expect.poll(() => rows.nth(i).locator("img").evaluate(img => img.complete && img.naturalWidth)).toBe(32);
    }
    await expect(usage).toContainText(language === "en" ? "Linked icons: 0 · Embedded covers: 0" : "远程图标 0 · 内嵌封面 0");
    expect(await extension.worker.evaluate(() => chrome.storage.local.get(null))).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await usage.screenshot({ path: `.output/icon-usage-${language}-expanded.png`, animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(0);
    await expect(summary).toBeFocused();

    await extension.worker.evaluate(async hash => {
      const { laterOnIcons: icons } = await chrome.storage.local.get("laterOnIcons");
      delete icons[hash];
      await chrome.storage.local.set({ laterOnIcons: { ...icons, ["f".repeat(64)]: "data:image/png;base64,AAAA" } });
    }, hashes[0]);
    await expect(usage.getByRole("status")).toBeVisible();
    const damaged = await extension.worker.evaluate(() => chrome.storage.local.get(null));
    await usage.getByRole("button", { name: language === "en" ? "Refresh" : "刷新", exact: true }).click();
    await expect(usage).toContainText(language === "en" ? "Missing icons for 9 saved pages." : "9 条收藏的图标缺失。");
    await summary.click();
    await expect(rows).toHaveCount(4);
    const orphan = rows.filter({ hasText: language === "en" ? "References: 0" : "0 次引用" });
    await expect(orphan).toContainText(language === "en" ? "Preview unavailable" : "无法预览");
    await expect(orphan.locator("img")).toHaveCount(0);
    expect(await extension.worker.evaluate(() => chrome.storage.local.get(null))).toEqual(damaged);

    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnItems: [], laterOnIcons: {} }));
    await expect(usage.getByRole("status")).toBeVisible();
    await usage.getByRole("button", { name: language === "en" ? "Refresh" : "刷新", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await expect(usage).toContainText(language === "en" ? "No embedded icons." : "暂无内嵌图标。");
    expect(errors).toEqual([]);
  });
}

test("图标详情：展开才读取、折叠取消旧结果、分页上限和失败重试", async ({ page, extension }) => {
  await seed(page, extension, await images(page));
  const values = await page.evaluate(() => Array.from({ length: 55 }, (_, i) => {
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = `hsl(${i * 6} 70% 45%)`; ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png");
  }));
  const hashes = values.map(value => createHash("sha256").update(value).digest("hex"));
  await extension.worker.evaluate(async ({ values, hashes }) => chrome.storage.local.set({
    laterOnItems: values.map((_value, i) => ({ id: `large-${i}`, url: `https://old-${i}.test/`, favicon: `icon://${hashes[i]}`, savedAt: i })),
    laterOnIcons: Object.fromEntries(values.map((value, i) => [hashes[i], value]))
  }), { values, hashes });
  await page.addInitScript(() => {
    window.iconReads = { count: 0, hold: false, fail: false, release: null };
    const read = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async keys => {
      if (!Array.isArray(keys) || keys.length !== 2 || !keys.includes("laterOnItems") || !keys.includes("laterOnIcons")) return read(keys);
      window.iconReads.count += 1;
      if (window.iconReads.fail) throw Error("Unavailable");
      const snapshot = await read(keys);
      return window.iconReads.hold ? new Promise(resolve => { window.iconReads.release = () => resolve(snapshot); }) : snapshot;
    };
  });
  await page.goto(new URL("settings.html", extension.url).href);
  const usage = page.getByRole("region", { name: "Storage usage" });
  const summary = usage.locator("summary"), rows = usage.getByRole("listitem");
  const refresh = usage.getByRole("button", { name: "Refresh", exact: true });
  const reads = () => page.evaluate(() => window.iconReads.count);
  await expect(usage).toContainText("Embedded icons: 55 references · 55 stored");
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(await reads()).toBe(0);
  await expect(usage.locator("img")).toHaveCount(0);

  await page.evaluate(() => { window.iconReads.hold = true; });
  await summary.click();
  await expect.poll(reads).toBe(1);
  await expect.poll(() => page.evaluate(() => typeof window.iconReads.release)).toBe("function");
  await summary.click();
  await extension.worker.evaluate(async () => {
    const { laterOnItems: items } = await chrome.storage.local.get("laterOnItems");
    await chrome.storage.local.set({ laterOnItems: items.map((item, i) => ({ ...item, url: `https://fresh-${i}.test/` })) });
  });
  await page.evaluate(() => { window.iconReads.hold = false; });
  await summary.click();
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText("fresh-");
  await page.evaluate(() => window.iconReads.release());
  await expect(rows.first()).toContainText("fresh-");
  expect(await reads()).toBe(2);
  const before = await extension.worker.evaluate(() => chrome.storage.local.get(null));
  const navigation = usage.getByRole("navigation", { name: "Icon pages" });
  await expect(navigation).toContainText("1 / 3");
  await expect(navigation.getByRole("button", { name: "Previous" })).toBeDisabled();
  await navigation.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(20);
  await expect(navigation).toContainText("2 / 3");
  await navigation.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(15);
  await expect(navigation).toContainText("3 / 3");
  await expect(navigation.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(await reads()).toBe(2, "Page changes reuse the open detail snapshot");
  await refresh.click();
  await expect(navigation).toContainText("1 / 3");
  await expect(rows).toHaveCount(20);
  expect(await reads()).toBe(3);
  await summary.click();
  await expect(rows).toHaveCount(0);
  await expect(usage.locator("img")).toHaveCount(0);

  await page.evaluate(() => { window.iconReads.fail = true; });
  await summary.click();
  await expect(usage.getByRole("alert")).toHaveText("Unable to load icons. Please retry.");
  await expect(rows).toHaveCount(0);
  await expect(usage).toContainText("Embedded icons: 55 references · 55 stored");
  await page.evaluate(() => { window.iconReads.fail = false; });
  await usage.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(rows).toHaveCount(20);
  expect(await reads()).toBe(5);
  expect(await extension.worker.evaluate(() => chrome.storage.local.get(null))).toEqual(before);
});
