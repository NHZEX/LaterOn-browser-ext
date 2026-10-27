const { test, expect } = require("./extension.cjs");
const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="324" height="200"><rect width="324" height="200" fill="#ff5c35"/></svg>')}`;

async function seed(worker, { theme = "light", language = "zh-CN", count = 12 } = {}) {
  await worker.evaluate(async ({ theme, language, count, cover }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      laterOnOnboardingSeen: true, laterOnFilter: "all", laterOnFilterChosen: true,
      laterOnSettings: { theme, language, autoMarkRead: false }, laterOnProjects: [],
      laterOnItems: Array.from({ length: count }, (_, index) => ({
        id: `n-${index}`, title: `Title ${index} 收藏卡片`, description: "Long description for the existing card layout. 收藏摘要。",
        source: "example.test", url: `https://example.test/${index}`, savedAt: Date.now() - index * 1000,
        status: "unread", image: index === 0 ? "local://n-0" : index === 1 ? "https://assets.example.test/missing.png" : ""
      })), laterOnCovers: { "n-0": cover }
    });
  }, { theme, language, count, cover });
}
const libraryUrl = extension => new URL("library.html?from=sidepanel&project=unfiled&filter=all", extension.url).href;
const ids = page => page.locator("#cardGrid .card").evaluateAll(cards => cards.map(card => card.dataset.id));
const settleCards = page => page.locator("#cardGrid .card").evaluateAll(cards =>
  Promise.all(cards.flatMap(card => card.getAnimations().map(animation => animation.finished.catch(() => {})))));

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`D5 页面生命周期、通知、快捷键与原文标签复用（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://assets.example.test/**", route => route.abort());
    await context.route("https://example.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Saved article</title><p>Article content</p>" }));
    await seed(extension.worker, { theme, language, count: 2 });
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnCurrentItem: "n-0" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${libraryUrl(extension)}&focus=n-0`);
    await expect(page.locator("#cardGrid .card")).toHaveCount(2);
    await expect(page.locator('#cardGrid [data-id="n-0"]')).toHaveClass(/is-current/);
    await page.keyboard.press("Control+k"); await expect(page.locator("#searchInput")).toBeFocused();
    const response = await extension.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: "SHOW_LIBRARY_NOTICE", tabId: tab.id, message: "Open a web page first · Alt+1" });
    });
    expect(response.shown).toBe(true);
    const toast = page.locator("#toast");
    await expect(toast).toHaveText("Open a web page first · Alt+1");
    await expect(toast).toHaveCSS("opacity", "1");
    await expect(toast).toHaveCSS("top", "18px"); await expect(toast).toHaveCSS("right", "18px");
    await expect(toast).toHaveCSS("border-radius", "999px");
    expect(await toast.evaluate(element => {
      const style = getComputedStyle(element, "::before"); return { content: style.content, color: style.color };
    })).toEqual({ content: '"✓"', color: "rgb(79, 226, 181)" });
    await page.setViewportSize({ width: 375, height: 640 }); await settleCards(page);
    await page.screenshot({ path: test.info().outputPath(`library-lifecycle-${theme}.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    const original = await context.newPage(); await original.goto("https://example.test/0");
    await page.bringToFront(); const count = context.pages().length;
    await page.locator('#cardGrid [data-id="n-0"] .description').click();
    await expect.poll(() => extension.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab.url;
    })).toBe("https://example.test/0");
    expect(context.pages().length).toBe(count); expect(page.url()).toContain("library.html");
    expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnCurrentItem")).laterOnCurrentItem)).toBe("n-0");
    expect(errors).toEqual([]);
  });
}

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`D4 项目排序、拖卡归类及侧栏宽度持久化（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://assets.example.test/**", route => route.abort());
    await page.setViewportSize({ width: 1440, height: 1000 }); await seed(extension.worker, { theme, language, count: 4 });
    await extension.worker.evaluate(async () => {
      const { laterOnItems: items } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnSidebarWidth: 320,
        laterOnProjects: [{ id: "hidden", name: "Archived pin", pinned: true, archived: true }, { id: "p", name: "Pinned", pinned: true }, { id: "a", name: "Project A" }, { id: "b", name: "Project B" }],
        laterOnItems: items.map((item, index) => ({ ...item, projectId: ["a", "b", "p", null][index] })) });
    });
    const stored = key => extension.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
    const rows = () => page.locator("#projectList .project-row").evaluateAll(rows => rows.map(row => row.dataset.id));
    await page.goto(new URL("library.html", extension.url).href); await expect(page.locator(".board-card")).toHaveCount(3);
    await page.locator(".board-card").evaluateAll(cards => Promise.all(cards.flatMap(card => card.getAnimations().map(animation => animation.finished.catch(() => {})))));
    const source = page.locator('#boardGrid .board-card[data-project="b"]'), target = page.locator('#boardGrid .board-card[data-project="a"]');
    const from = await source.boundingBox(), to = await target.boundingBox();
    const data = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent("dragstart", { dataTransfer: data, clientX: from.x + 8, clientY: from.y + 8 });
    await expect(source).toHaveClass(/dragging/); await expect(source.locator(".board-cover")).toBeHidden();
    await expect(source).toHaveCSS("opacity", "1"); await expect(source).toHaveCSS("animation-name", "none");
    await expect(page.locator("#boardGrid")).toHaveCSS("position", "relative");
    const home = await page.locator(".drag-home-frame").boundingBox();
    expect(home.x).toBeCloseTo(from.x, 0); expect(home.y).toBeCloseTo(from.y, 0);
    await target.dispatchEvent("dragover", { dataTransfer: data, clientX: to.x + 8, clientY: to.y + 8 });
    await expect.poll(async () => (await source.boundingBox()).x).toBeCloseTo(to.x, 0);
    expect(await rows()).toEqual(["p", "a", "b"]);
    await page.locator("#boardGrid").dispatchEvent("drop", { dataTransfer: data }); await source.dispatchEvent("dragend", { dataTransfer: data });
    await expect.poll(rows).toEqual(["p", "b", "a"]);
    await expect.poll(async () => (await stored("laterOnProjects")).map(project => project.id)).toEqual(["hidden", "p", "b", "a"]);
    // 原生鼠标从项目行发起，验证拖影 / 指示线和置顶分区实际可用。
    const rowFrom = await page.locator('.project-row[data-id="a"]').boundingBox(), rowTo = await page.locator('.project-row[data-id="b"]').boundingBox();
    await page.mouse.move(rowFrom.x + 70, rowFrom.y + 15); await page.mouse.down();
    await page.mouse.move(rowFrom.x + 72, rowFrom.y + 25, { steps: 5 });
    await expect(page.locator(".folder-drag-preview")).toHaveCount(1);
    await page.mouse.move(rowTo.x + 70, rowTo.y + 2, { steps: 10 }); await expect(page.locator(".folder-drop-line")).toHaveCount(1);
    await page.mouse.up(); await expect.poll(rows).toEqual(["p", "a", "b"]);
    await page.locator('.project-nav[data-project="unfiled"]').click(); await expect(page.locator("#cardGrid .card")).toHaveCount(1); await settleCards(page);
    const card = await page.locator('#cardGrid [data-id="n-3"]').boundingBox(), project = await page.locator('.project-row[data-id="a"]').boundingBox();
    await page.mouse.move(card.x + 6, card.y + 6); await page.mouse.down();
    await page.mouse.move(card.x + 20, card.y + 20, { steps: 5 }); await expect(page.locator(".drag-preview")).toHaveCount(1);
    await page.mouse.move(project.x + 80, project.y + 16, { steps: 15 });
    await expect(page.locator('.project-row[data-id="a"]')).toHaveClass(/drop-target/);
    await page.mouse.up(); await expect(page.locator("#cardGrid .card")).toHaveCount(0);
    await expect.poll(async () => (await stored("laterOnItems")).find(item => item.id === "n-3").projectId).toBe("a");
    const handle = page.locator("#sidebarResizer"); const bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 64, bounds.y + 100, { steps: 8 });
    await expect(handle).toHaveAttribute("aria-valuenow", "384"); await page.mouse.up();
    await expect.poll(() => stored("laterOnSidebarWidth")).toBe(384);
    const resized = await handle.boundingBox();
    await page.mouse.move(resized.x + resized.width / 2, resized.y + 100); await page.mouse.down();
    await page.mouse.move(resized.x + resized.width / 2 - 40, resized.y + 100, { steps: 8 });
    await page.keyboard.press("Escape"); await page.mouse.up(); await expect(handle).toHaveAttribute("aria-valuenow", "384");
    expect(await stored("laterOnSidebarWidth")).toBe(384);
    await handle.focus(); await page.keyboard.press("Home"); await expect(handle).toHaveAttribute("aria-valuenow", "240");
    await page.keyboard.press("Enter"); await page.keyboard.press("Space"); await expect(page.locator("#sidebarSizeControls")).toBeVisible();
    await page.locator('[data-sidebar-size="wider"]').click(); await expect(handle).toHaveAttribute("aria-valuenow", "304");
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnSidebarWidth: 400 })); await expect(handle).toHaveAttribute("aria-valuenow", "400");
    await page.setViewportSize({ width: 700, height: 1000 });
    const narrowWidth = await page.locator(".workspace").evaluate(element => element.clientWidth - 360);
    await expect(handle).toHaveAttribute("aria-valuenow", String(narrowWidth));
    expect(await stored("laterOnSidebarWidth")).toBe(400);
    await page.setViewportSize({ width: 1440, height: 1000 }); await expect(handle).toHaveAttribute("aria-valuenow", "400");
    await page.screenshot({ path: test.info().outputPath(`library-d4-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 }); await expect(handle).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload(); await expect(handle).toHaveAttribute("aria-valuenow", "400");
    await expect.poll(rows).toEqual(["p", "a", "b"]);
    await page.locator('.project-nav[data-project="a"]').click(); await expect(page.locator('#cardGrid [data-id="n-3"]')).toBeVisible();
    await expect(page.locator(".drag-preview, .drag-home-frame, .folder-drag-preview, .folder-drop-line, .drop-target, .dragging, .is-dragging")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`D3 编辑、封面上传与项目命令持久化（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://assets.example.test/**", route => route.abort());
    await seed(extension.worker, { theme, language, count: 2 });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(libraryUrl(extension));
    const first = page.locator('#cardGrid [data-id="n-0"]');
    const modal = page.locator(".lod-root:not([hidden])");
    const title = modal.locator('[data-field="title"]');
    const save = () => modal.locator(".lod-ok").click();
    const stored = key => extension.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
    await expect(first).toBeVisible(); await first.locator(".edit").focus(); await page.keyboard.press("Enter"); await expect(title).toBeFocused();
    await title.fill("Cancelled"); await page.keyboard.press("Escape"); await expect(modal).toHaveCount(0);
    await expect(first.locator(".edit")).toBeFocused(); await expect(first.locator("h2")).toHaveText("Title 0 收藏卡片");
    await page.keyboard.press("Enter"); await title.fill("Edited in Chromium");
    await modal.locator('input[type="file"]').setInputFiles({ name: "cover.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrLkAAAAASUVORK5CYII=", "base64") });
    await expect(modal.locator(".lod-cover-preview img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
    const bounds = await modal.locator(".lod-panel").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: test.info().outputPath(`library-edit-${theme}.png`), fullPage: true });
    await save(); await expect(modal).toHaveCount(0); await expect(first.locator("h2")).toHaveText("Edited in Chromium");
    await expect(first.locator(".edit")).toBeFocused();
    const coverData = (await stored("laterOnCovers"))["n-0"];
    expect(coverData).toMatch(/^data:image\/jpeg;base64,/); expect((await stored("laterOnItems"))[0].image).toBe("local://n-0");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.project-nav[data-project="all"]').click(); await page.locator(".board-create").click();
    await modal.locator('[data-field="name"]').fill("D3 Project"); await save(); await expect(modal).toHaveCount(0);
    const id = (await stored("laterOnProjects"))[0].id;
    const row = page.locator(`.project-row[data-id="${id}"]`);
    await expect(row.locator(".project-name")).toHaveText("D3 Project");
    await row.locator(".project-nav").focus(); await page.keyboard.press("F2"); const rename = row.locator(".project-rename");
    await expect(rename).toBeFocused(); await rename.fill("D3 Renamed"); await page.keyboard.press("Enter");
    await expect(row.locator(".project-name")).toHaveText("D3 Renamed"); await expect(row.locator(".project-nav")).toBeFocused();
    await page.locator('.project-nav[data-project="unfiled"]').click();
    await first.locator(".project-select").focus(); await page.keyboard.press("Enter");
    const picker = page.locator("#lateron-folder-picker");
    await picker.locator(".lon-folder").filter({ hasText: "D3 Renamed" }).click(); await picker.locator(".lon-primary").click();
    await expect(first).toHaveCount(0); await expect(row.locator(".nav-count")).toHaveText("1");
    await page.locator('.project-nav[data-project="all"]').click();
    const board = page.locator(`.board-card[data-project="${id}"]`);
    await board.locator(".board-edit").focus(); await page.keyboard.press("Enter"); await modal.locator('[data-field="note"]').fill("Project note from Chromium");
    await modal.locator(".lod-pick").click(); await save(); await expect(modal).toHaveCount(0);
    await expect(board.locator(".board-note")).toHaveText("Project note from Chromium");
    expect((await stored("laterOnProjects"))[0].coverPick).toEqual(["n-0"]);
    expect((await stored("laterOnProjects"))[0].cover).toBeUndefined();
    await row.locator(".project-more").click(); await page.getByRole("menu").locator('[data-action="archive"]').click();
    await expect(row).toHaveCount(0); await expect(board).toBeVisible();
    await board.click({ button: "right" }); await page.getByRole("menu").locator('[data-action="archive"]').click();
    await expect(row).toBeVisible(); await expect(first).toBeVisible();
    await page.reload(); await row.locator(".project-nav").click(); await expect(first.locator("h2")).toHaveText("Edited in Chromium");
    await expect(first.locator(".cover-img")).toHaveAttribute("src", coverData);
    expect((await stored("laterOnProjects"))[0]).toMatchObject({ name: "D3 Renamed", note: "Project note from Chromium", archived: false, coverPick: ["n-0"] });
    expect(errors).toEqual([]);
  });
}

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`Vue 收藏卡片保留封面、缺图、键盘操作与布局（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("https://assets.example.test/**", route => route.abort());
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(extension.worker, { theme, language });
    await page.goto(libraryUrl(extension));
    const first = page.locator('#cardGrid [data-id="n-0"]');
    await expect(page.locator("#cardGrid .card")).toHaveCount(12);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect.poll(() => first.locator(".cover-img").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.locator('[data-id="n-1"] .cover-placeholder')).toBeVisible();
    await expect(first.locator(".title-link")).toHaveAttribute("href", "https://example.test/0");
    expect(await first.locator(".cover-img").evaluate(image => image.referrerPolicy)).toBe("no-referrer");
    expect(await first.locator(".favicon").evaluate(image => image.referrerPolicy)).toBe("no-referrer");
    await settleCards(page);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await first.evaluate(card => {
        const cover = card.querySelector(".cover").getBoundingClientRect();
        const image = card.querySelector(".cover-img").getBoundingClientRect();
        return { viewport: innerWidth, scroll: document.documentElement.scrollWidth,
          cover: { width: cover.width, height: cover.height }, image: { width: image.width, height: image.height },
          card: card.getBoundingClientRect().width };
      });
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.viewport);
      expect(bounds.card).toBeGreaterThanOrEqual(width < 620 ? 140 : 190);
      expect(bounds.cover.width / bounds.cover.height).toBeCloseTo(1.62, 2);
      expect(bounds.image).toEqual(bounds.cover);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const toggle = first.locator(".read-toggle");
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(first).toHaveClass(/is-read/);
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems[0].status)).toBe("done");
    await page.locator("#selectMode").click();
    await first.locator(".title-link").click();
    await expect(first.locator(".select-check")).toBeChecked();
    await expect(first).toHaveClass(/selected/);
    await page.locator("#bulkDone").click();
    await expect(first.locator(".select-check")).not.toBeChecked();
    await page.reload();
    await expect(page.locator('#cardGrid [data-id="n-0"]')).toHaveClass(/is-read/);
    await settleCards(page);
    await expect.poll(() => first.locator(".cover-img").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`library-${theme}.png`), fullPage: true });
  });
}

test("真实布局中拖拽让位生效且不重排 DOM，松手后持久化顺序", async ({ page, context, extension }) => {
  await context.route("https://assets.example.test/**", route => route.abort());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(extension.worker, { count: 4 });
  await page.goto(libraryUrl(extension));
  await expect(page.locator("#cardGrid .card")).toHaveCount(4);
  await settleCards(page);
  await page.mouse.move(0, 0);
  // Explicit events allow inspection before drop; the next test covers the native mouse entry.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const source = page.locator('#cardGrid [data-id="n-3"]');
  const target = page.locator('#cardGrid [data-id="n-0"]');
  const sourceBox = await source.boundingBox(), targetBox = await target.boundingBox();
  const before = await ids(page);
  await source.dispatchEvent("dragstart", { dataTransfer: transfer, clientX: sourceBox.x + 20, clientY: sourceBox.y + 30 });
  await expect(source).toHaveClass(/dragging/);
  await expect(source.locator(".card-body")).toBeHidden();
  await expect(source).toHaveCSS("cursor", "grabbing");
  await target.dispatchEvent("dragover", { dataTransfer: transfer, clientX: targetBox.x + 10, clientY: targetBox.y + 10 });
  await expect.poll(async () => {
    const box = await source.boundingBox();
    return Math.abs(box.x - targetBox.x) < 1 && Math.abs(box.y - targetBox.y) < 1;
  }).toBe(true);
  expect(await ids(page)).toEqual(before);
  const home = await page.locator(".drag-home-frame").boundingBox();
  expect(Math.abs(home.x - sourceBox.x)).toBeLessThan(1);
  expect(Math.abs(home.y - sourceBox.y)).toBeLessThan(1);
  await expect(page.locator(".drag-home-frame")).toHaveCSS("pointer-events", "none");
  for (let turn = 0; turn < 5; turn++) {
    await target.dispatchEvent("dragover", { dataTransfer: transfer, clientX: targetBox.x + 8 + turn, clientY: targetBox.y + 9 });
  }
  expect(await ids(page)).toEqual(before);
  await page.locator("#cardGrid").dispatchEvent("drop", { dataTransfer: transfer, clientX: targetBox.x + 10, clientY: targetBox.y + 10 });
  await expect.poll(() => ids(page)).toEqual(["n-3", "n-0", "n-1", "n-2"]);
  await expect(page.locator(".drag-home-frame, .drag-preview, .dragging")).toHaveCount(0);
  await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnOrder")).laterOnOrder.unfiled)).toEqual(["n-3", "n-0", "n-1", "n-2"]);
  await page.reload();
  await expect.poll(() => ids(page)).toEqual(["n-3", "n-0", "n-1", "n-2"]);
});

test("鼠标可从卡片空白处发起原生拖拽并保存顺序", async ({ page, context, extension }) => {
  await context.route("https://assets.example.test/**", route => route.abort());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(extension.worker, { count: 4 });
  await page.goto(libraryUrl(extension));
  await expect(page.locator("#cardGrid .card")).toHaveCount(4);
  await settleCards(page);
  const source = page.locator('#cardGrid [data-id="n-3"]');
  const target = page.locator('#cardGrid [data-id="n-0"]');
  const from = await source.boundingBox(), to = await target.boundingBox();
  await page.mouse.move(from.x + 6, from.y + 6);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await expect(source).toHaveClass(/dragging/);
  await page.mouse.move(to.x + 8, to.y + 8, { steps: 12 });
  await page.mouse.move(to.x + 10, to.y + 10);
  await page.mouse.up();
  await expect.poll(() => ids(page)).toEqual(["n-3", "n-0", "n-1", "n-2"]);
  await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnOrder")).laterOnOrder.unfiled)).toEqual(["n-3", "n-0", "n-1", "n-2"]);
  await expect(page.locator(".drag-home-frame, .drag-preview, .dragging")).toHaveCount(0);
});

test("卡片网格实际铺满可用宽度，出现滚动条时导航不横移", async ({ page, context, extension }) => {
  await context.route("https://assets.example.test/**", route => route.abort());
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seed(extension.worker, { count: 4 });
  await page.goto(libraryUrl(extension));
  await expect(page.locator("#cardGrid .card")).toHaveCount(4);
  await settleCards(page);
  const position = () => page.locator("#projectSidebar").evaluate(element => element.getBoundingClientRect().x);
  const before = await position();
  await extension.worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("laterOnItems");
    await chrome.storage.local.set({ laterOnItems: Array.from({ length: 24 }, (_, index) => ({ ...stored.laterOnItems[0], id: `n-${index}` })) });
  });
  await expect(page.locator("#cardGrid .card")).toHaveCount(24);
  await settleCards(page);
  expect(await position()).toBeCloseTo(before, 1);
  const bounds = await page.evaluate(() => {
    const grid = document.querySelector("#cardGrid").getBoundingClientRect();
    const cards = [...document.querySelectorAll("#cardGrid .card")].map(card => card.getBoundingClientRect());
    const firstRow = cards.filter(card => Math.abs(card.top - cards[0].top) < 1);
    return { width: grid.width, columns: firstRow.length, rightGap: grid.right - firstRow.at(-1).right,
      scrolls: document.documentElement.scrollHeight > innerHeight };
  });
  expect(bounds.columns).toBe(6);
  expect(Math.abs(bounds.rightGap)).toBeLessThan(1);
  expect(bounds.scrolls).toBe(true);
});

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`Vue 菜单键盘、焦点和外部同步（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://assets.example.test/**", route => route.abort());
    await seed(extension.worker, { theme, language, count: 4 });
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnProjects: [{ id: "p", name: "Menu project" }] }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(libraryUrl(extension));
    const more = page.locator('.project-row[data-id="p"] .project-more');
    const popup = page.getByRole("menu");
    await more.focus(); await page.keyboard.press("Enter");
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-action="pin"]')).toBeFocused();
    await page.keyboard.press("End"); await expect(popup.locator('[data-action="delete"]')).toBeFocused();
    await page.keyboard.press("ArrowDown"); await expect(popup.locator('[data-action="pin"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(popup).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnProjects")).laterOnProjects[0].pinned)).toBe(true);
    await page.keyboard.press("Enter");
    await extension.worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("laterOnProjects");
      await chrome.storage.local.set({ laterOnProjects: stored.laterOnProjects.map(project => ({ ...project, name: "External menu name" })) });
    });
    await expect(popup.locator(".folder-menu-title")).toHaveText("External menu name");
    await page.keyboard.press("Escape"); await expect(more).toBeFocused();
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    await expect(popup).toHaveCount(0);
    await expect(page.locator("#searchInput")).not.toBeFocused();
    await expect(more).not.toBeFocused();
    await more.click(); await page.keyboard.press("Shift+Tab");
    await expect(popup).toHaveCount(0);
    await expect(page.locator('.project-nav[data-project="p"]')).toBeFocused();
    // Native Enter activates a menu item and the dialog retains its own focus.
    await more.click(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
    await expect(page.locator(".lod-root:not([hidden])")).toBeVisible();
    await expect(page.locator(".lod-root:not([hidden]) .lod-panel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".lod-root:not([hidden])")).toHaveCount(0);
    const card = page.locator('#cardGrid [data-id="n-0"]');
    await card.locator(".title-link").focus(); await page.keyboard.press("Shift+F10");
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape"); await expect(card.locator(".title-link")).toBeFocused();
    await page.setViewportSize({ width: 375, height: 640 });
    await settleCards(page);
    async function openCardMenu() {
      // The menu dismisses on scroll. Finish locator auto-scrolling before opening it.
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await card.click({ button: "right", position: { x: 8, y: 8 } });
    }
    await openCardMenu();
    await expect(popup).toBeVisible();
    await expect(popup).toHaveCSS("opacity", "1");
    const box = await popup.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(7); expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.x + box.width).toBeLessThanOrEqual(368); expect(box.y + box.height).toBeLessThanOrEqual(633);
    await page.screenshot({ path: test.info().outputPath(`library-menu-${theme}.png`) });
    await page.setViewportSize({ width: 390, height: 640 }); await expect(popup).toHaveCount(0);
    await openCardMenu();
    await page.mouse.wheel(0, 400); await expect(popup).toHaveCount(0);
    await openCardMenu();
    await page.locator("#searchInput").click(); await expect(popup).toHaveCount(0);
    await openCardMenu();
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-action="open"]')).toBeFocused();
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnItems: [] }));
    await expect(popup).toHaveCount(0); await expect(page.locator("#searchInput")).toBeFocused();
    expect(errors).toEqual([]);
  });
}

for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
  test(`Vue 批量工具栏真实键盘、移动与删除持久化（${theme}/${language}）`, async ({ page, context, extension }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://assets.example.test/**", route => route.abort());
    await seed(extension.worker, { theme, language, count: 4 });
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnProjects: [{ id: "p", name: "Bulk project" }] }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(libraryUrl(extension));
    const first = page.locator('#cardGrid [data-id="n-0"]');
    await expect(page.locator("#cardGrid .card")).toHaveCount(4);
    await page.locator("#selectMode").focus(); await page.keyboard.press("Enter");
    await first.locator(".select-check").focus(); await page.keyboard.press("Space");
    await expect(first.locator(".select-check")).toBeChecked();
    await first.locator(".read-toggle").focus(); await page.keyboard.press("Tab");
    const projectSelect = first.locator(".project-select");
    await expect(projectSelect).toBeFocused();
    for (const key of ["End", "Home", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter", "Space", "b"]) {
      await page.keyboard.press(key);
      await expect(projectSelect).toHaveValue("");
      await expect(page.locator("#lateron-folder-picker")).toHaveCount(0);
    }
    await expect(first.locator(".select-check")).toBeChecked();
    await expect(page.locator("#cardGrid .card")).toHaveCount(4);
    expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems[0].projectId ?? null)).toBe(null);
    await expect(page.locator("#bulkBar")).toBeVisible();
    await expect(page.locator("#bulkRead")).toBeEnabled();
    await page.locator("#bulkRead").focus();
    await expect(page.locator("#bulkRead")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first).toHaveClass(/is-read/);
    await expect(page.locator("#selectMode")).toBeFocused();
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems[0].status)).toBe("done");
    await page.keyboard.press("Enter"); await page.locator("#bulkSelectAll").click();
    await page.locator("#bulkProject").click();
    const picker = page.locator("#lateron-folder-picker");
    await picker.locator(".lon-folder").filter({ hasText: "Bulk project" }).click();
    await picker.locator(".lon-primary").click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator("#cardGrid .card")).toHaveCount(0);
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems.every(item => item.projectId === "p"))).toBe(true);
    await page.locator('.project-nav[data-project="p"]').click();
    await page.setViewportSize({ width: 375, height: 640 }); await settleCards(page);
    await page.locator("#selectMode").click(); await page.locator("#bulkSelectAll").click();
    const bar = page.locator("#bulkBar");
    await expect(bar).toHaveCSS("opacity", "1");
    const bounds = await bar.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375); expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    await page.screenshot({ path: test.info().outputPath(`library-bulk-${theme}.png`) });
    await page.locator("#bulkDelete").click(); await page.locator(".lod-root:not([hidden]) .lod-cancel").click();
    await expect(bar).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".select-check:checked")).toHaveCount(4);
    await page.locator("#bulkDelete").click(); await page.locator(".lod-root:not([hidden]) .lod-ok").click();
    await expect(page.locator("#cardGrid .card")).toHaveCount(0);
    await page.reload(); await expect(page.locator("#cardGrid .card")).toHaveCount(0);
    await expect.poll(() => extension.worker.evaluate(async () => {
      const store = await chrome.storage.local.get(["laterOnItems", "laterOnCovers"]);
      return { count: store.laterOnItems.length, covers: Object.keys(store.laterOnCovers).length };
    })).toEqual({ count: 0, covers: 0 });
    expect(errors).toEqual([]);
  });
}
