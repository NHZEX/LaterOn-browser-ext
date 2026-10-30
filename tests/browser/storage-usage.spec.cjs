const { test, expect } = require("./extension.cjs");

const icon = "data:image/png;base64,AAAA";
const settingsUrl = extension => new URL("settings.html", extension.url).href;
async function seed(worker, language = "en") {
  await worker.evaluate(async language => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ laterOnSettings: { language, theme: "dark", autoCleanEnabled: false },
      laterOnItems: [], laterOnProjects: [], laterOnCovers: {} });
  }, language);
}
const panel = page => page.getByRole("region", { name: /Storage usage|存储占用/ });
const totalText = worker => worker.evaluate(async () => {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const index = bytes >= 1024 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: index ? 2 : 0 }).format(bytes / 1024 ** index)} ${["B", "KiB", "MiB", "GiB"][index]}`;
});

test("存储占用：真实总量、图片分类、手动刷新且不修改收藏", async ({ page, extension }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await seed(extension.worker);
  await page.goto(settingsUrl(extension));
  const usage = panel(page);
  await expect(usage).toContainText("Saved pages: 0 · Projects: 0");
  await expect(usage.locator(".storage-total strong")).toHaveText(await totalText(extension.worker));
  await expect(usage).toContainText("Embedded icons: 0 references · 0 stored");
  await extension.worker.evaluate(async icon => chrome.storage.local.set({
    laterOnItems: [
      { id: "one", title: "中文标题", favicon: icon, image: "local://one" },
      { id: "two", favicon: "https://example.test/favicon.ico", image: icon }
    ], laterOnProjects: [{ id: "p", cover: icon }], laterOnCovers: { one: icon, orphan: icon }
  }), icon);
  await expect(usage.getByRole("status")).toHaveText("Data has changed. Refresh to see the latest usage.");
  await expect(usage).toContainText("Saved pages: 0 · Projects: 0");
  const before = await extension.worker.evaluate(() => chrome.storage.local.get(null));
  await usage.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(usage).toContainText("Saved pages: 2 · Projects: 1");
  await expect(usage).toContainText("Embedded icons: 1 references · 1 stored");
  await usage.locator("summary").click();
  await expect(usage).toContainText("Linked icons: 1 · Embedded covers: 4");
  await expect(usage.locator(".storage-total strong")).toHaveText(await totalText(extension.worker));
  await expect(usage.locator(".storage-breakdown > div").filter({ hasText: "Embedded site icons" }).locator("dd")).toHaveText(`${Buffer.byteLength(icon)} B`);
  await expect(usage.locator(".storage-breakdown > div").filter({ hasText: "Embedded covers" }).locator("dd")).toHaveText(`${4 * Buffer.byteLength(icon)} B`);
  await expect(usage.getByRole("status")).toHaveCount(0);
  expect(await extension.worker.evaluate(() => chrome.storage.local.get(null))).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("存储占用：首次读取失败与刷新失败都能重试，保留上次结果", async ({ page, extension }) => {
  await seed(extension.worker, "zh-CN");
  await page.addInitScript(() => {
    window.storageTest = { fail: "bytes" };
    const local = chrome.storage.local;
    const read = local.get.bind(local), bytes = local.getBytesInUse.bind(local);
    local.get = keys => keys === null && window.storageTest.fail === "get" ? Promise.reject(Error("unavailable")) : read(keys);
    local.getBytesInUse = keys => window.storageTest.fail === "bytes" ? Promise.reject(Error("unavailable")) : bytes(keys);
  });
  await page.goto(settingsUrl(extension));
  const usage = panel(page);
  await expect(usage.getByRole("alert")).toHaveText("暂时无法读取存储占用，请重试。");
  await expect(usage.locator(".storage-total")).toHaveCount(0);
  await page.evaluate(() => { window.storageTest.fail = ""; });
  await usage.getByRole("button", { name: "重试" }).click();
  await expect(usage).toContainText("0 条收藏 · 0 个项目");
  const previous = await usage.locator(".storage-total strong").textContent();
  await page.evaluate(() => { window.storageTest.fail = "get"; });
  await usage.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(usage.getByRole("alert")).toHaveText("刷新失败，当前显示上次的统计。请重试。");
  await expect(usage.locator(".storage-total strong")).toHaveText(previous);
  await page.evaluate(() => { window.storageTest.fail = ""; });
  await usage.getByRole("button", { name: "重试" }).click();
  await expect(usage.getByRole("alert")).toHaveCount(0);
});

test("存储占用：读取期间变更保持待刷新提示，不把旧结果当作最新", async ({ page, extension }) => {
  await seed(extension.worker);
  await page.addInitScript(() => {
    window.storageTest = { hold: false, release: null, notified: false };
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === "local") window.storageTest.notified = true;
    });
    const read = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async keys => {
      const snapshot = await read(keys);
      if (keys !== null || !window.storageTest.hold) return snapshot;
      return new Promise(resolve => { window.storageTest.release = () => resolve(snapshot); });
    };
  });
  await page.goto(settingsUrl(extension));
  const usage = panel(page);
  await expect(usage).toContainText("Saved pages: 0 · Projects: 0");
  await page.evaluate(() => { window.storageTest.hold = true; window.storageTest.notified = false; });
  await usage.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(usage.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => typeof window.storageTest.release)).toBe("function");
  await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnItems: [{ id: "new", title: "Added during read" }] }));
  await expect.poll(() => page.evaluate(() => window.storageTest.notified)).toBe(true);
  await page.evaluate(() => { window.storageTest.hold = false; window.storageTest.release(); });
  await expect(usage.getByRole("status")).toHaveText("Data has changed. Refresh to see the latest usage.");
  await expect(usage).toContainText("Saved pages: 0 · Projects: 0");
  await usage.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(usage).toContainText("Saved pages: 1 · Projects: 0");
  await expect(usage.getByRole("status")).toHaveCount(0);
});
