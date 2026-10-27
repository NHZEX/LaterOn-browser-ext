const { test, expect } = require("./extension.cjs");

const articleUrl = "https://f3c.test/article";
async function openArticle(context, page, worker) {
  await context.route("https://f3c.test/**", route => route.fulfill({ contentType: "text/html", body:
    '<html lang="en"><title>F3c article</title><meta property="og:description" content="Native injection description"><style>article{min-height:5000px}p{font-size:16px}</style><article><p>First paragraph has enough text for translation.</p><p>Second paragraph also has enough text for translation.</p><p>Third paragraph has enough text for translation.</p></article></html>' }));
  await page.goto(articleUrl);
  return worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, articleUrl);
}
const inject = (worker, tabId, file, world = "ISOLATED") => worker.evaluate(async ({ tabId, file, world }) =>
  (await chrome.scripting.executeScript({ target: { tabId }, world, files: [file] }))[0].result, { tabId, file, world });

test("F3c：元数据返回、阅读位置重复注入、恢复与持久化", async ({ context, page, extension }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await extension.worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ laterOnSettings: { language: "en", autoMarkRead: false },
      laterOnItems: [{ id: "article", title: "F3c article", url: "https://f3c.test/article", savedAt: Date.now(), status: "unread" }],
      laterOnReadingPositions: { article: 820 } });
  });
  const client = await context.newPage(); await client.goto(extension.url);
  const tabId = await openArticle(context, page, extension.worker);
  const extracted = await client.evaluate(tabId => chrome.runtime.sendMessage({ type: "EXTRACT_METADATA", tabId }), tabId);
  expect(extracted.ok).toBe(true); expect(extracted.metadata.title).toBe("F3c article");
  expect(extracted.metadata.description).toBe("Native injection description");
  const prompt = page.locator("#lateron-reading-position");
  await expect(prompt.getByRole("button", { name: "Continue from last position" })).toBeVisible();
  for (let repeat = 0; repeat < 2; repeat += 1) {
    await inject(extension.worker, tabId, "content-reading-position.js");
    await extension.worker.evaluate(tabId => chrome.tabs.sendMessage(tabId,
      { type: "LATERON_READING_POSITION_INIT", itemId: "article", y: 820, language: "en" }), tabId);
  }
  await expect(prompt).toHaveCount(1);
  const geometry = await prompt.boundingBox();
  expect(Math.abs(geometry.y + geometry.height / 2 - 400)).toBeLessThan(2);
  expect(geometry.x + geometry.width).toBeCloseTo(375 - 12, 0);
  expect(await prompt.locator(".box").evaluate(element => getComputedStyle(element).borderRadius)).toBe("999px");
  expect(await prompt.locator(".mark").evaluate(element => {
    const style = getComputedStyle(element);
    return [style.width, style.height, style.borderRadius];
  })).toEqual(["36px", "36px", "50%"]);
  expect(await prompt.locator(".resume").evaluate(element => {
    const style = getComputedStyle(element);
    return [style.paddingLeft, style.paddingRight];
  })).toEqual(["20px", "20px"]);
  await prompt.getByRole("button", { name: "Continue from last position" }).click();
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(820);
  // Wait for the delayed restoration to finish before moving to a new position.
  await expect.poll(() => extension.worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId },
    func: () => globalThis.__laterOnReadingPosition.armed }).then(result => result[0].result), tabId)).toBe(true);
  await page.evaluate(() => scrollTo(0, 1200));
  await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnReadingPositions")).laterOnReadingPositions.article)).toBe(1200);
  await page.evaluate(() => { history.scrollRestoration = "manual"; });
  await page.reload(); await expect(prompt.getByRole("button", { name: "Continue from last position" })).toBeVisible();
  await prompt.getByRole("button", { name: "Continue from last position" }).click();
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(1200);
  expect(errors).toEqual([]);
});

test("F3c：翻译 Promise 返回值、译文、恢复原文和失败反馈", async ({ context, page, extension }) => {
  const tabId = await openArticle(context, page, extension.worker);
  // Translator is an external browser API. The page selection and rendering remain real.
  await page.evaluate(() => {
    window.translationDestroyed = 0;
    Object.defineProperty(window, "Translator", { configurable: true, value: {
      availability: async () => "available", create: async () => ({ translate: async text => `译文：${text}`,
        destroy: () => { window.translationDestroyed += 1; } })
    } });
  });
  await extension.worker.evaluate(tabId => chrome.scripting.insertCSS({ target: { tabId }, files: ["translation.css"] }), tabId);
  expect(await inject(extension.worker, tabId, "content-translation.js", "MAIN")).toEqual({ ok: true, translatedCount: 3, sourceLanguage: "en" });
  const translations = page.locator('[aria-label="中文译文"]');
  await expect(translations).toHaveCount(3); await expect(translations.first()).toBeVisible();
  expect(await page.evaluate(() => window.translationDestroyed)).toBe(1);
  expect(await inject(extension.worker, tabId, "content-translation.js", "MAIN")).toEqual({ ok: true, removed: true });
  await expect(translations).toHaveCount(0); await expect(page.locator("article p")).toHaveCount(3);
  await page.evaluate(() => { delete window.Translator; });
  const failure = await inject(extension.worker, tabId, "content-translation.js", "MAIN");
  expect(failure.ok).toBe(false); expect(failure.error).toContain("不支持本机网页翻译");
  await expect(page.locator("#lateron-translation-status")).toHaveText(failure.error);
});

test("F3c：翻译中再次注入会取消，迟到结果不复活译文", async ({ context, page, extension }) => {
  const tabId = await openArticle(context, page, extension.worker);
  await page.evaluate(() => {
    window.translationStarted = 0; window.translationDestroyed = 0;
    const pending = new Promise(resolve => { window.finishTranslation = resolve; });
    Object.defineProperty(window, "Translator", { configurable: true, value: {
      availability: async () => "available", create: async () => ({
        translate: () => { window.translationStarted += 1; return pending; }, destroy: () => { window.translationDestroyed += 1; }
      })
    } });
  });
  const first = inject(extension.worker, tabId, "content-translation.js", "MAIN");
  await expect.poll(() => page.evaluate(() => window.translationStarted)).toBe(3);
  expect(await inject(extension.worker, tabId, "content-translation.js", "MAIN")).toEqual({ ok: true, removed: true });
  await page.evaluate(() => window.finishTranslation("迟到译文"));
  expect(await first).toEqual({ ok: true, removed: true });
  await expect(page.locator('[aria-label="中文译文"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.translationDestroyed)).toBe(1);
});
