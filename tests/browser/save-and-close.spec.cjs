const { test, expect } = require("./extension.cjs");

// 通过 QUICK_SAVE_TAB close=true 走与右键「添加并关闭」相同的 quickSave(..., close) 路径。
// 系统原生右键菜单外观与 OS 通知横幅仍仅人工验收，见 roadmap。

test("扩展内触发收藏并关闭：保存后关闭原标签并保留其他标签", async ({ page, context, extension }) => {
  const errors = [];
  extension.worker.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  await extension.worker.evaluate(async () => {
    await chrome.storage.local.set({
      laterOnCleanupV165: true,
      laterOnItems: [],
      laterOnProjects: [],
      laterOnSettings: { language: "zh-CN", autoCleanEnabled: false, askFolderOnSingle: false }
    });
  });

  await context.route("https://save-close-browser.test/**", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Save and close article</title><p>Article</p>"
  }));
  const article = await context.newPage();
  await article.goto("https://save-close-browser.test/article");
  await (await context.newPage()).goto("https://save-close-browser.test/other");

  await page.goto(new URL("save-project-picker.html", extension.url).href);

  const tabIds = await extension.worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return {
      articleId: tabs.find(tab => tab.url === "https://save-close-browser.test/article")?.id,
      otherId: tabs.find(tab => tab.url === "https://save-close-browser.test/other")?.id
    };
  });
  expect(tabIds.articleId).toBeTruthy();
  expect(tabIds.otherId).toBeTruthy();

  const saved = await page.evaluate(tabId => chrome.runtime.sendMessage({
    type: "QUICK_SAVE_TAB", tabId, source: "menu", close: true
  }), tabIds.articleId);
  expect(saved.ok).toBe(true);

  await expect.poll(() => extension.worker.evaluate(async () =>
    ((await chrome.storage.local.get("laterOnItems")).laterOnItems || []).length
  )).toBe(1);

  await expect.poll(() => extension.worker.evaluate(async (otherId) => {
    const tabs = await chrome.tabs.query({});
    return {
      hasArticle: tabs.some(tab => tab.url === "https://save-close-browser.test/article"),
      hasOther: tabs.some(tab => tab.id === otherId)
    };
  }, tabIds.otherId), { timeout: 5000 }).toEqual({ hasArticle: false, hasOther: true });

  expect(errors).toEqual([]);
});
