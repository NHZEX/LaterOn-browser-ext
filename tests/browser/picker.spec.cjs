const { test, expect } = require("./extension.cjs");

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`F3 单文件网页选择器：重复收藏、新建、持久化与取消（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = [];
    context.on("page", tab => tab.on("pageerror", error => errors.push(error.message)));
    page.on("pageerror", error => errors.push(error.message));
    await extension.worker.evaluate(async ({ theme, language }) => {
      await chrome.storage.local.set({ laterOnCleanupV165: true, laterOnItems: [], laterOnProjects: [],
        laterOnSettings: { theme, language, autoCleanEnabled: false, askFolderOnSingle: true, askFolderOnSingleOptIn: true } });
    }, { theme, language });
    await context.route("https://f3.test/**", route => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><title>F3 native picker article</title><meta property="og:description" content="Saved via the native picker"><style>button { display:none !important; }</style><p>Article</p>' }));
    const article = await context.newPage();
    await article.goto("https://f3.test/article");
    const tabId = await extension.worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === "https://f3.test/article").id);
    await page.goto(new URL("save-project-picker.html", extension.url).href);
    const request = () => page.evaluate(tabId => chrome.runtime.sendMessage({ type: "QUICK_SAVE_TAB", tabId }), tabId);
    expect((await request()).pending).toBe(true);
    const picker = article.locator("#lateron-folder-picker");
    await expect(picker.locator(".lon-primary")).toBeVisible();
    const firstBatch = await extension.worker.evaluate(async () => (await chrome.storage.session.get("laterOnPendingBatch")).laterOnPendingBatch.batchId);
    expect((await request()).pending).toBe(true);
    await expect(picker).toHaveCount(1);
    const stale = await page.evaluate(batchId => chrome.runtime.sendMessage({ type: "CONFIRM_BATCH_SAVE", batchId }), firstBatch);
    expect(stale.ok).toBe(false);
    if (theme === "dark") await expect(picker.locator(".lon-root")).toHaveAttribute("data-dark", "1");
    else await expect(picker.locator(".lon-root")).not.toHaveAttribute("data-dark");
    await expect(picker.locator(".lon-primary")).toBeVisible(); // Hostile page CSS cannot hide Shadow DOM buttons.
    await expect(picker.locator(".lon-panel")).toHaveCSS("border-radius", "18px");
    await expect(picker.locator(".lon-primary")).toHaveCSS("background-image", /linear-gradient/);
    expect(await extension.worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId },
      func: () => ["openFolderPicker", "showFolderPickerOverlay"].filter(name => name in window) }))[0].result, tabId)).toEqual([]);
    expect(await extension.worker.evaluate(() => chrome.runtime.getManifest().content_scripts || [])).toEqual([]);
    await picker.locator(".lon-new-input").fill("F3 New Project");
    await picker.locator(".lon-primary").click();
    await expect(picker).toHaveCount(0);
    await expect.poll(() => extension.worker.evaluate(async () => {
      const data = await chrome.storage.local.get(["laterOnItems", "laterOnProjects"]);
      return data.laterOnItems?.length === 1 && data.laterOnProjects?.some(project =>
        project.name === "F3 New Project" && project.id === data.laterOnItems[0].projectId);
    })).toBe(true);
    expect((await request()).pending).toBe(true);
    await expect(picker.locator(".lon-primary")).toBeVisible();
    await article.bringToFront();
    await article.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    expect(await extension.worker.evaluate(async () => (await chrome.storage.session.get("laterOnPendingBatch")).laterOnPendingBatch)).toBeUndefined();
    expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems.length)).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`F3 原生独立选择页：批次确认、过期关闭与主题（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("https://picker-page.test/**", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><title>Standalone picker save</title><p>Article</p>" }));
    const article = await context.newPage();
    await article.goto("https://picker-page.test/article");
    // Supply a pending request at the session-storage boundary; saving and messages use the actual worker.
    await extension.worker.evaluate(async ({ theme, language }) => {
      await chrome.storage.local.set({ laterOnCleanupV165: true, laterOnItems: [],
        laterOnProjects: [{ id: "work", name: "F3 Work", createdAt: 1 }],
        laterOnSettings: { theme, language, autoCleanEnabled: false } });
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === "https://picker-page.test/article");
      await chrome.storage.session.set({ laterOnPendingBatch: { batchId: "standalone", createdAt: Date.now(),
        projectId: "work", tabs: [{ id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title }] } });
    }, { theme, language });
    await page.goto(new URL("save-project-picker.html?batch=standalone", extension.url).href);
    await expect(page.locator("#lateron-folder-picker .lon-primary")).toContainText("F3 Work");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => typeof window.openFolderPicker)).toBe("undefined");
    const closed = page.waitForEvent("close");
    await page.keyboard.press("Enter");
    await closed;
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems?.[0]?.projectId)).toBe("work");
    const expired = await context.newPage();
    expired.on("pageerror", error => errors.push(error.message));
    await expired.goto(new URL("save-project-picker.html?batch=standalone", extension.url).href);
    await expect(expired.locator("#pickerStatus")).toContainText(language === "en" ? "expired" : "过期");
    await expect(expired.locator("#lateron-folder-picker")).toHaveCount(0);
    const expiredClosed = expired.waitForEvent("close");
    await expired.locator("#closePicker").click();
    await expiredClosed;
    expect(errors).toEqual([]);
  });
}
