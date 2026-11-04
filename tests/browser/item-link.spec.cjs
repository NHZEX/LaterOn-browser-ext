const { test, expect } = require("./extension.cjs");

const item = { id: "link", title: "Guide [draft]", description: "A saved page", source: "Example", status: "unread", savedAt: 1,
  url: `https://example.test/topic_(draft)?q=%E4%B8%AD&next=https%3A%2F%2Fexample.test%2F&long=${"abcdefghij".repeat(20)}#section` };
const markdown = `[Guide \\[draft\\]](${item.url.replace("(draft)", "%28draft%29")})`;
const labels = {
  en: { url: "Page URL", copy: "Copy link", more: "More copy formats", plain: "Copy plain URL", markdown: "Copy Markdown link", success: "Link copied", failure: "Copy failed. Try again or copy the URL manually from the edit dialog." },
  "zh-CN": { url: "网页 URL", copy: "复制链接", more: "其他复制格式", plain: "复制纯 URL", markdown: "复制 Markdown 链接", success: "链接已复制", failure: "复制失败，请重试或在编辑窗口中手动复制 URL。" }
};

for (const name of ["library", "sidepanel"]) {
  for (const language of ["en", "zh-CN"]) {
    test(`${name} ${language}: full URL and copy menu preserve data, keyboard focus and clipboard retry`, async ({ page, context, extension }, testInfo) => {
      await page.setViewportSize({ width: language === "en" ? 375 : 1100, height: 800 });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await extension.worker.evaluate(async ({ item, language }) => {
        const fillers = language === "en" ? Array.from({ length: 16 }, (_, index) => ({ ...item, id: `other-${index}`, title: `Other page ${index}`, savedAt: index + 2 })) : [];
        await chrome.storage.local.clear();
        await chrome.storage.local.set({ laterOnOnboardingSeen: true,
          laterOnSettings: { language, theme: language === "en" ? "dark" : "light", autoMarkRead: false, autoCleanEnabled: false },
          laterOnItems: [item, ...fillers], laterOnProjects: [], laterOnCovers: {}, laterOnActiveProject: "unfiled", laterOnFilter: "all", laterOnFilterChosen: true });
      }, { item, language });
      const destination = new URL(`${name}.html?from=sidepanel&project=unfiled&filter=all`, extension.url).href;
      await page.goto(destination);
      const card = page.locator('[data-id="link"]');
      await expect(card.locator("h2")).toHaveText(item.title);
      const originalPages = context.pages();
      const original = await extension.worker.evaluate(() => chrome.storage.local.get(["laterOnItems", "laterOnCovers", "laterOnCurrentItem", "laterOnReadingPositions"]));
      const text = labels[language];
      const edit = card.locator(".edit");
      await edit.focus(); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      const title = dialog.locator('[data-field="title"]');
      const url = dialog.getByRole("textbox", { name: text.url, exact: true });
      await expect(title).toBeFocused();
      await expect(url).toHaveValue(item.url);
      await expect(url).toHaveJSProperty("readOnly", true);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${language}-url.png`) });
      await page.keyboard.press("Tab"); await expect(url).toBeFocused();
      await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(edit).toBeFocused();

      const primary = card.getByRole("button", { name: text.plain, exact: true });
      const trigger = card.getByRole("button", { name: text.more, exact: true });
      const menu = page.getByRole("menu", { name: text.more, exact: true });
      const notice = page.locator(name === "library" ? "#toast" : "#panelToast");
      await primary.focus(); await page.keyboard.press("Enter");
      await expect(menu).toBeHidden(); await expect(notice).toHaveText(text.success);
      await expect(notice).toBeVisible(); await expect(notice).toHaveCSS("opacity", "1");
      const noticeBox = await notice.boundingBox();
      expect(noticeBox.y).toBeGreaterThanOrEqual(0); expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(page.viewportSize().height);
      expect(noticeBox.x).toBeGreaterThanOrEqual(0); expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(page.viewportSize().width);
      if (language === "en") expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${language}-success.png`) });
      // 第一次复制按真实用户手势执行；之后只授权读取，检查系统剪贴板内容。
      await context.grantPermissions(["clipboard-read"]);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.url);
      await page.keyboard.press("Tab"); await expect(trigger).toBeFocused();
      await trigger.focus(); await page.keyboard.press("Enter");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveCount(2);
      const box = await menu.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${language}-copy.png`) });
      await page.keyboard.press("Escape"); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
      await trigger.focus(); await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: text.plain, exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: text.markdown, exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
      await card.hover(); await trigger.click(); await menu.getByRole("menuitem", { name: text.plain, exact: true }).click();
      await expect(menu).toBeHidden(); await expect(notice).toHaveText(text.success);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.url);
      await card.hover(); await trigger.click(); await menu.getByRole("menuitem", { name: text.markdown, exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
      await card.hover(); await primary.click();
      await expect(menu).toBeHidden();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.url);

      await page.evaluate(() => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        window.denyClipboard = true;
        Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: text => window.denyClipboard ? Promise.reject(new Error("Denied")) : write(text) });
      });
      await primary.click();
      await expect(notice).toHaveText(text.failure);
      await trigger.click(); await menu.getByRole("menuitem", { name: text.markdown, exact: true }).click();
      await expect(notice).toHaveText(text.failure);
      await page.evaluate(() => { window.denyClipboard = false; });
      await card.hover(); await primary.click();
      await expect(notice).toHaveText(text.success);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.url);
      await card.hover(); await edit.click(); await expect(dialog).toBeVisible();
      await url.focus(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.press("ControlOrMeta+c");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.url);
      await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
      await page.clock.install();
      await primary.focus(); await page.keyboard.press("Enter");
      await expect(notice).toHaveText(text.success);
      await page.clock.fastForward(1500);
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(item.url);
      await page.clock.fastForward(1700);
      await expect(notice).toBeVisible(); await expect(notice).toHaveCSS("opacity", "1");
      await expect(primary).toBeFocused();
      await page.clock.fastForward(3100);
      if (name === "library") await expect(notice).toHaveCSS("opacity", "0");
      else await expect(notice).toBeHidden();
      expect(page.url()).toBe(destination); expect(context.pages()).toEqual(originalPages);
      expect(await extension.worker.evaluate(() => chrome.storage.local.get(["laterOnItems", "laterOnCovers", "laterOnCurrentItem", "laterOnReadingPositions"]))).toEqual(original);
      expect(errors).toEqual([]);
    });
  }
}
