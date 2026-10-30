const { test, expect } = require("./extension.cjs");

async function seed(worker, language = "en") {
  await worker.evaluate(async language => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnCleanupV165: true,
      laterOnSettings: { language, theme: language === "en" ? "dark" : "light", autoCleanEnabled: false },
      laterOnItems: [], laterOnProjects: [], laterOnCovers: {} });
  }, language);
}
const url = (extension, hash = "") => new URL(`settings.html${hash}`, extension.url).href;
const general = page => page.getByRole("tab", { name: /^(General|常规设置)$/ });
const data = page => page.getByRole("tab", { name: /^(Data & maintenance|数据与维护)$/ });
const usage = page => page.getByRole("region", { name: /^(Storage usage|存储占用)$/ });
async function trackReads(page) {
  await page.addInitScript(() => {
    window.reads = { usage: 0, diagnostics: 0, fail: false, hold: false, release: null };
    const read = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async keys => {
      if (keys === null) window.reads.usage += 1;
      if (!Array.isArray(keys) || !keys.includes("laterOnDiag")) return read(keys);
      window.reads.diagnostics += 1;
      if (window.reads.fail) throw Error("fixture diagnostics read failed");
      const result = await read(keys);
      return window.reads.hold ? new Promise(resolve => { window.reads.release = () => resolve(result); }) : result;
    };
  });
}

for (const language of ["zh-CN", "en"]) {
  test(`设置分层：${language} 默认常规、键盘切换、深链接与只读按需加载`, async ({ page, extension }) => {
    await seed(extension.worker, language);
    await trackReads(page);
    await page.setViewportSize({ width: language === "en" ? 375 : 1360, height: 900 });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(url(extension));
    await expect(general(page)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.locator('[data-setting="theme"]')).toBeVisible();
    await expect(page.locator('[data-setting="autoCleanEnabled"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.reads)).toMatchObject({ usage: 0, diagnostics: 0 });
    await page.screenshot({ path: test.info().outputPath(`settings-tabs-${language}-general.png`), fullPage: true });
    const before = await extension.worker.evaluate(() => chrome.storage.local.get(null));
    await general(page).focus(); await page.keyboard.press("ArrowRight");
    await expect(data(page)).toBeFocused();
    await expect(data(page)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/#data$/);
    await expect(usage(page)).toContainText(language === "en" ? "Saved pages: 0" : "0 条收藏");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.locator('[data-setting="autoCleanEnabled"]')).toBeVisible();
    await expect(page.locator('[data-setting="theme"]')).not.toBeVisible();
    expect(await page.evaluate(() => window.reads)).toMatchObject({ usage: 1, diagnostics: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const labels = await page.getByRole("tabpanel").locator("h2").allTextContents();
    expect(labels).toEqual(language === "en" ? ["Backup & restore", "Storage usage", "Automatic cleanup", "Diagnostics", "Danger zone"]
      : ["备份与恢复", "存储占用", "自动清理", "运行诊断", "危险操作"]);
    await page.screenshot({ path: test.info().outputPath(`settings-tabs-${language}-data.png`), fullPage: true });
    await page.reload();
    await expect(data(page)).toHaveAttribute("aria-selected", "true");
    await expect(usage(page)).toBeVisible();
    await data(page).focus(); await page.keyboard.press("Home");
    await expect(general(page)).toHaveAttribute("aria-selected", "true");
    await expect(general(page)).toBeFocused();
    await expect(usage(page)).toHaveCount(0);
    await page.evaluate(() => { location.hash = "data"; });
    await expect(usage(page)).toBeVisible();
    await page.evaluate(() => { location.hash = "unknown"; });
    await expect(general(page)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/#general$/);
    expect(await extension.worker.evaluate(() => chrome.storage.local.get(null))).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test("运行诊断：展开才读取和轮询，折叠或离开停止，丢弃旧结果并允许失败重试", async ({ page, extension }) => {
  await seed(extension.worker);
  await trackReads(page);
  await page.goto(url(extension, "#data"));
  await expect(usage(page)).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const reads = () => page.evaluate(() => window.reads.diagnostics);
  const details = page.locator(".settings-diagnostics"), summary = details.locator("summary");
  await page.clock.runFor(6000); expect(await reads()).toBe(0);
  await page.evaluate(() => { window.reads.hold = true; });
  await summary.click();
  await expect.poll(() => page.evaluate(() => typeof window.reads.release)).toBe("function");
  await summary.click();
  await page.clock.runFor(6000); expect(await reads()).toBe(1);
  await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnDiag: { lastError: "fresh diagnostics", lastErrorAt: Date.now() } }));
  await page.evaluate(() => { window.reads.hold = false; });
  await summary.click();
  await expect(details).toContainText("fresh diagnostics");
  await page.evaluate(() => window.reads.release());
  await expect(details).toContainText("fresh diagnostics");
  await page.clock.runFor(2100); expect(await reads()).toBe(3);
  await general(page).click();
  await expect(details).toHaveCount(0);
  await page.clock.runFor(6000); expect(await reads()).toBe(3);
  await data(page).click();
  await page.clock.runFor(6000); expect(await reads()).toBe(3);
  await page.evaluate(() => { window.reads.fail = true; });
  await summary.click();
  await expect(details.getByRole("alert")).toContainText("Unable to read diagnostics.");
  await page.evaluate(() => { window.reads.fail = false; });
  await details.getByRole("button", { name: "Try again" }).click();
  await expect(details.getByRole("alert")).toHaveCount(0);
  await expect(details).toContainText("fresh diagnostics");
  await summary.click();
  await expect(details.locator("#diagShortcut")).toHaveCount(0);
  const stopped = await reads();
  await page.clock.runFor(6000); expect(await reads()).toBe(stopped);
});

for (const action of ["BACKUP_EXPORT", "BACKUP_APPLY"]) {
  for (const fail of [false, true]) {
    test(`数据面板：${action} 切换期间${fail ? "失败后可重试" : "继续完成"}，保留选项与操作锁`, async ({ page, extension }) => {
      await seed(extension.worker);
      await page.addInitScript(action => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        window.backupGate = { release: null, fail: false, hold: true };
        chrome.runtime.sendMessage = async message => {
          if (message.type !== action) return send(message);
          if (window.backupGate.hold) await new Promise(resolve => { window.backupGate.release = resolve; });
          if (window.backupGate.fail) throw Error("fixture request failed");
          return send(message);
        };
      }, action);
      await page.goto(url(extension, "#data"));
      await expect(usage(page)).toBeVisible();
      await page.locator("#exportImages").check();
      await page.locator("#importMode").selectOption("replace");
      const dialog = page.getByRole("dialog");
      const payload = { format: "lateron.collection", version: 1, appVersion: "1", exportedAt: new Date().toISOString(), data: {
        items: [{ id: "imported", url: "https://example.test/", title: "Imported", savedAt: 1, status: "unread" }],
        projects: [], covers: {}, order: {}, readingPositions: {} } };
      async function begin() {
        if (action === "BACKUP_EXPORT") await page.locator("#exportBtn").click();
        else {
          await page.locator("#importFile").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
          await expect(dialog).toBeVisible();
          await dialog.locator(".lod-ok").click();
        }
      }
      await begin();
      await expect.poll(() => page.evaluate(() => typeof window.backupGate.release)).toBe("function");
      await general(page).click();
      await expect(page.locator("#exportBtn")).toBeDisabled();
      await expect(page.locator("#wipeBtn")).toBeDisabled();
      const download = action === "BACKUP_EXPORT" && !fail ? page.waitForEvent("download") : null;
      await page.evaluate(fail => { window.backupGate.fail = fail; window.backupGate.hold = false; window.backupGate.release(); }, fail);
      if (download) await download;
      if (fail || action === "BACKUP_APPLY") {
        await expect(dialog).toBeVisible();
        await expect(page.locator(".lod-root")).toHaveAttribute("data-tone", fail ? "danger" : "success");
        await dialog.locator(".lod-ok").click();
      }
      await data(page).click();
      await expect(page.locator("#exportBtn")).toBeEnabled();
      await expect(page.locator("#wipeBtn")).toBeEnabled();
      await expect(page.locator("#exportImages")).toBeChecked();
      await expect(page.locator("#importMode")).toHaveValue("replace");
      if (fail) {
        expect((await extension.worker.evaluate(() => chrome.storage.local.get("laterOnItems"))).laterOnItems).toHaveLength(0);
        await page.evaluate(() => { window.backupGate.fail = false; });
        const retried = action === "BACKUP_EXPORT" ? page.waitForEvent("download") : null;
        await begin();
        if (retried) await retried;
        else { await expect(page.locator(".lod-root")).toHaveAttribute("data-tone", "success"); await dialog.locator(".lod-ok").click(); }
      }
      if (action === "BACKUP_APPLY") {
        expect((await extension.worker.evaluate(() => chrome.storage.local.get("laterOnItems"))).laterOnItems).toMatchObject([{ title: "Imported" }]);
      }
    });
  }
}
