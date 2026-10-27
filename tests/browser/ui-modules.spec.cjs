const { test, expect } = require("./extension.cjs");

async function seed(worker, seen = true) {
  await worker.evaluate(async seen => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ laterOnOnboardingSeen: seen, laterOnSettings: { language: "en", theme: "dark", autoMarkRead: false },
      laterOnItems: [{ id: "one", title: "Original", description: "Summary", url: "https://example.test/one", savedAt: 1, status: "unread" }],
      laterOnProjects: [], laterOnCovers: {}, laterOnActiveProject: "unfiled", laterOnFilter: "all", laterOnFilterChosen: true });
  }, seen);
}
const url = (extension, name, guide = false) => new URL(`${name}.html?from=sidepanel&project=unfiled&filter=all${guide ? "&guide=1" : ""}`, extension.url).href;
const stored = (worker, key) => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);

for (const name of ["library", "sidepanel"]) {
  test(`F3b ${name}：模块语言、按需编辑、封面持久化与焦点恢复`, async ({ page, extension }) => {
    const errors = [], scripts = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname); });
    await seed(extension.worker);
    await page.goto(url(extension, name));
    const card = page.locator('[data-id="one"]'), edit = card.locator(".edit");
    await expect(card.locator("h2")).toHaveText("Original");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(scripts.filter(path => /\/dialog-[^/]+\.js$/.test(path))).toHaveLength(0);
    expect(await page.evaluate(() => ["LaterOnI18n", "LaterOnDialog", "LaterOnOnboarding"].filter(key => key in window))).toEqual([]);
    await edit.focus(); await page.keyboard.press("Enter");
    const dialog = page.locator(".lod-root:not([hidden])"), title = dialog.locator('[data-field="title"]');
    await expect(title).toBeFocused();
    await expect(dialog.locator(".lod-ok")).toHaveText("Save");
    await title.fill("Module edit");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "cover.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrLkAAAAASUVORK5CYII=", "base64") });
    await expect(dialog.locator(".lod-cover-note")).toContainText("Ready");
    await dialog.locator(".lod-ok").click();
    await expect(card.locator("h2")).toHaveText("Module edit"); await expect(edit).toBeFocused();
    expect((await stored(extension.worker, "laterOnCovers")).one).toMatch(/^data:image\/jpeg;base64,/);
    expect(scripts.filter(path => /\/dialog-[^/]+\.js$/.test(path))).toHaveLength(1);
    await expect(page.locator(".settings-shell")).toHaveCount(0);
    expect(scripts.some(path => /\/(i18n|onboarding|dialog)\.js$/.test(path))).toBe(false);
    await page.reload(); await expect(card.locator("h2")).toHaveText("Module edit");
    expect(errors).toEqual([]);
  });

  test(`F3b ${name}：首次引导、语言通知、已读持久化与显式重播`, async ({ page, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await seed(extension.worker, false); await page.goto(url(extension, name));
    const guide = page.locator(".lon-guide"), next = guide.locator(".lon-guide-next");
    await expect(guide.locator("h2")).toHaveText("Add now, continue anytime");
    await expect(guide.getByRole("dialog")).toBeFocused();
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "zh-CN", theme: "dark" } }));
    await expect(guide.locator("h2")).toHaveText("一键添加，随时继续浏览");
    await next.click(); await expect(guide.locator("h2")).toHaveText("用项目保持井然有序");
    await expect(guide.locator(".lon-guide-page")).not.toHaveClass(/is-entering|is-leaving/);
    await next.click(); await expect(next).toHaveText("开始使用");
    await expect(guide.locator(".lon-guide-page")).not.toHaveClass(/is-entering|is-leaving/);
    await next.click(); await expect(guide).toHaveCount(0);
    await expect.poll(() => stored(extension.worker, "laterOnOnboardingSeen")).toBe(true);
    await page.reload(); await expect(page.locator('[data-id="one"]')).toBeVisible(); await expect(guide).toHaveCount(0);
    await page.goto(url(extension, name, true)); await expect(guide).toBeVisible();
    await page.keyboard.press("Escape"); await expect(guide).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("F3b 侧栏：弹窗样式加载失败保留数据，重试后可取消删除", async ({ page, extension }) => {
  await seed(extension.worker);
  let fail = true;
  await page.route("**/dialog.css", route => fail ? route.abort() : route.continue());
  await page.goto(url(extension, "sidepanel"));
  const card = page.locator('[data-id="one"]');
  await card.locator(".delete").click(); await expect(page.locator("#status")).toHaveText("Something went wrong. Try again.");
  await expect(card).toBeVisible(); expect((await stored(extension.worker, "laterOnItems"))).toHaveLength(1);
  fail = false; await card.locator(".delete").click();
  const dialog = page.locator(".lod-root:not([hidden])"); await expect(dialog).toBeVisible();
  await dialog.locator(".lod-cancel").click(); await expect(dialog).toHaveCount(0);
  await expect(card).toBeVisible(); expect((await stored(extension.worker, "laterOnItems"))).toHaveLength(1);
});
