const { test, expect } = require("./extension.cjs");

const title = "Cursor++ 轻指南 v0.0.16 · 收藏提示与跨主题展示";

async function prepare({ context, page, extension }, { theme, language = "zh-CN", reduced = false }) {
  await extension.worker.evaluate(async ({ theme, language }) => {
    await chrome.storage.local.set({ laterOnCleanupV165: true, laterOnOnboardingSeen: true,
      laterOnItems: [], laterOnProjects: [], laterOnCovers: {}, laterOnActiveProject: "unfiled",
      laterOnSettings: { theme, language, askFolderOnSingle: false, autoMarkRead: false, autoCleanEnabled: false } });
  }, { theme, language });
  await context.route("https://save-feedback.test/**", route => route.fulfill({ contentType: "text/html", body:
    `<!doctype html><meta charset="utf-8"><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="Real saved article">
    <style>body{background:${theme === "light" ? "#131514" : "#fff"};color:#888}
    div,span,svg{display:none!important;color:magenta!important;background:red!important;font:40px monospace!important}</style>
    <main><h1>${title}</h1><p>Host page styles must not change the notification.</p></main>` }));
  await page.goto(extension.url);
  const article = await context.newPage();
  await article.emulateMedia({ colorScheme: "dark", reducedMotion: reduced ? "reduce" : "no-preference" });
  await article.goto("https://save-feedback.test/article");
  await expect(page.locator("#currentTitle")).toHaveText(title);
  await page.locator("#saveCurrent").click();
  return { article, host: article.locator("#lateron-pill-stack") };
}

for (const [theme, language, surface, foreground] of [
  ["light", "zh-CN", "rgb(255, 243, 214)", "rgb(36, 26, 11)"],
  ["dark", "en", "rgb(59, 45, 24)", "rgb(255, 243, 214)"]
]) {
  test(`收藏成功卡片：真实侧栏保存、主题高亮与网页样式隔离 ${theme}/${language}`, async ({ context, page, extension }, testInfo) => {
    const { article, host } = await prepare({ context, page, extension }, { theme, language });
    const notice = host.locator(".notice");
    await expect(notice.locator(".headline")).toHaveText(language === "en" ? "Saved" : "已收藏");
    await expect(notice.locator(".detail")).toHaveText(title);
    await expect(notice.locator("svg")).toBeVisible();
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems?.length)).toBe(1);
    // Inspect actual rendering at the animation's peak and settled phase, with no business mocks.
    await notice.evaluate(element => element.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 450; }));
    await expect(notice).toHaveCSS("background-color", "rgb(255, 181, 46)");
    await expect(notice).toHaveCSS("color", "rgb(36, 26, 11)");
    await notice.evaluate(element => element.getAnimations().forEach(animation => { animation.currentTime = 1500; }));
    await expect(notice).toHaveCSS("background-color", surface);
    await expect(notice).toHaveCSS("color", foreground);
    await expect(notice.locator(".headline")).toHaveCSS("font-size", "15px");
    expect(await notice.evaluate(element => { const rect=element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })).toBe(true);
    await article.screenshot({ path: testInfo.outputPath(`save-notice-${theme}.png`) });
    await expect(host).toHaveCount(0);

    const tabId = await extension.worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === "https://save-feedback.test/article").id);
    expect((await page.evaluate(tabId => chrome.runtime.sendMessage({ type: "QUICK_SAVE_TAB", tabId }), tabId)).duplicated).toBe(true);
    await expect(host.locator(".notice")).toContainText(language === "en" ? "already" : "添加过");
    // Duplicate feedback remains in its theme color throughout the time at which a new save would flash.
    await host.locator(".notice").evaluate(element => element.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 450; }));
    await expect(host.locator(".notice")).toHaveCSS("background-color", surface);
    expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems.length)).toBe(1);
  });
}

test("收藏提示跟随系统主题、减少动态效果和同页设置切换", async ({ context, page, extension }) => {
  const { article, host } = await prepare({ context, page, extension }, { theme: "system", reduced: true });
  await expect(host.locator(".headline")).toHaveText("已收藏");
  await host.locator(".notice").evaluate(element => element.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 600; }));
  await expect(host.locator(".notice")).toHaveCSS("background-color", "rgb(255, 181, 46)");
  await expect(host.locator(".notice")).toHaveCSS("transform", "none");
  expect(await host.locator(".mark").evaluate(element => element.getAnimations().length)).toBe(0);
  await host.locator(".notice").evaluate(element => element.getAnimations().forEach(animation => { animation.currentTime = 1800; }));
  await expect(host.locator(".notice")).toHaveCSS("background-color", "rgb(59, 45, 24)");
  await extension.worker.evaluate(async () => {
    const settings=(await chrome.storage.local.get("laterOnSettings")).laterOnSettings;
    await chrome.storage.local.set({ laterOnSettings: { ...settings, theme: "light" } });
  });
  const tabId=await extension.worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === "https://save-feedback.test/article").id);
  await page.evaluate(tabId => chrome.runtime.sendMessage({ type: "QUICK_SAVE_TAB", tabId }), tabId);
  await expect(host.locator(".notice").last()).toHaveCSS("background-color", "rgb(255, 243, 214)");
  await expect(host).toHaveCount(1);
  await expect(host).toHaveCount(0);
  await expect(article.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});
