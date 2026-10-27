const fs = require("node:fs/promises");
const path = require("node:path");
const { test, expect, buildDir } = require("./extension.cjs");

const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="92" height="120"><rect width="92" height="120" fill="red"/></svg>')}`;
const seed = async (worker, theme) => worker.evaluate(async ({ theme, cover }) => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    laterOnOnboardingSeen: true,
    laterOnSettings: { theme, language: "zh-CN", autoMarkRead: false },
    laterOnItems: [
      { id: "cover", title: "封面应铺满卡片的多行长标题，避免底部留下空白", description: "多行摘要用来撑开卡片高度，封面和占位都应跟随文字高度伸展。", source: "example.test", url: "https://example.test/cover", image: "local://cover", savedAt: Date.now(), status: "unread" },
      { id: "placeholder", title: "无封面时显示占位图", description: "占位图片不应反过来撑高卡片。", source: "example.test", url: "https://example.test/placeholder", image: "", savedAt: Date.now() - 1000, status: "unread" }
    ],
    laterOnCovers: { cover }, laterOnProjects: [], laterOnActiveProject: "all"
  });
}, { theme, cover });

test("F3d：主页面脚本失败时独立启动，异步样式恢复且十二秒兜底生效", async ({ context, page }) => {
  const blockedStyles = [];
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.addInitScript(() => {
    window.chrome = { storage: { local: { get: async () => ({ laterOnSettings: { language: "en" } }) } } };
  });
  await context.route("https://lateron-boot.test/**", async route => {
    const request = route.request(), file = new URL(request.url()).pathname.slice(1);
    if (request.resourceType() === "script" && file !== "boot.js") return route.abort();
    if (request.resourceType() === "stylesheet") { blockedStyles.push(route); return; }
    await route.fulfill({ body: await fs.readFile(path.join(buildDir, file)),
      contentType: file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "image/png" });
  });
  try {
    await page.goto("https://lateron-boot.test/sidepanel.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#bootSkeleton")).toBeVisible();
    await expect(page.locator("#appBody")).toBeHidden();
    await expect(page.locator("#bootTipText")).toHaveText("Opening your saves…");
    await expect(page.locator("#bootTip")).toBeHidden();
    expect(await page.locator("link[data-boot-style]").evaluateAll(links => links.map(link => link.media))).toEqual(["print", "print", "print"]);
    await expect.poll(() => blockedStyles.length).toBe(3);
    await page.clock.runFor(1400);
    await expect(page.locator("#bootTip")).toBeVisible();
    await Promise.all(blockedStyles.splice(0).map(async route => route.fulfill({
      body: await fs.readFile(path.join(buildDir, new URL(route.request().url()).pathname.slice(1))), contentType: "text/css"
    })));
    await expect.poll(() => page.locator("link[data-boot-style]").evaluateAll(links => links.every(link => link.media === "all"))).toBe(true);
    await expect(page.locator("body")).toHaveCSS("padding", "0px");
    await page.clock.runFor(4800);
    await expect(page.locator("#bootTipHint")).toContainText("Close and reopen the side panel");
    await page.clock.runFor(6200);
    await expect(page.locator("#bootSkeleton")).toHaveCount(0);
    await expect(page.locator("#bootTip")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveClass(/booting/);
  } finally { await Promise.all(blockedStyles.map(route => route.abort())); }
});

for (const [language, theme] of [["zh-CN", "light"], ["en", "dark"]]) {
  test(`E4：当前页元数据、实际保存、切页与完整界面交接 ${language}/${theme}`, async ({ context, page, extension }, testInfo) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://e4.test/**", route => route.fulfill({ contentType: "text/html", body:
      '<title>E4 tab title</title><meta property="og:title" content="E4 metadata title"><meta property="og:description" content="E4 description"><main>Article body</main>' }));
    await extension.worker.evaluate(async ({ language, theme }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnItems: [], laterOnProjects: [], laterOnCovers: {},
        laterOnSettings: { language, theme, askFolderOnSingle: false, autoMarkRead: false }, laterOnActiveProject: "unfiled" });
    }, { language, theme });
    await page.goto(extension.url);
    await expect(page.locator("body")).not.toHaveClass(/booting/);
    const article = await context.newPage(); await article.goto("https://e4.test/article");
    await expect(page.locator("#currentTitle")).toHaveText("E4 metadata title");
    await expect(page.locator("#saveCurrent")).toBeEnabled();
    await page.locator("#saveCurrent").click();
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems?.length)).toBe(1);
    await expect(page.locator("#saveCurrent")).toHaveClass(/saved/);
    await expect(page.locator("#items .item h2")).toHaveText("E4 metadata title");
    await article.goto("https://e4.test/next"); await expect(page.locator("#saveCurrent")).toBeEnabled();
    await article.goto("https://e4.test/article"); await expect(page.locator("#saveCurrent")).toHaveClass(/saved/);
    const current = await extension.worker.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { windowId: active.windowId, item: (await chrome.storage.local.get("laterOnItems")).laterOnItems[0] };
    });
    const ping = await extension.worker.evaluate(windowId => chrome.runtime.sendMessage({ type: "PING_SIDEPANEL", windowId }), current.windowId);
    expect(ping.ready).toBe(true);
    expect((await extension.worker.evaluate(windowId => chrome.runtime.sendMessage({ type: "PING_SIDEPANEL", windowId }), current.windowId + 100)).ready).toBe(false);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`e4-${language}-${theme}.png`), fullPage: true });
    const opened = context.waitForEvent("page");
    await page.locator("#openLibrary").click();
    const library = await opened; await library.waitForURL(/library\.html\?/);
    const target = new URL(library.url());
    expect(Object.fromEntries(target.searchParams)).toEqual({ from: "sidepanel", project: "unfiled", filter: "unread", focus: current.item.id });
    await expect(library.locator(`#cardGrid [data-id="${current.item.id}"]`)).toHaveClass(/is-current/);
    expect(errors).toEqual([]);
  });
}

for (const [language, theme] of [["zh-CN", "light"], ["en", "dark"]]) {
  test(`E3：菜单键盘、编辑同步、原生拖拽与文章复用 ${language}/${theme}`, async ({ context, page, extension }, testInfo) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("https://e3.test/**", route => route.fulfill({ contentType: "text/html", body: "<title>E3 article</title><main>Article</main>" }));
    await extension.worker.evaluate(async ({ language, theme }) => {
      await chrome.storage.local.clear();
      const item = (id, savedAt, status = "unread") => ({ id, title: `E3 ${id}`, url: `https://e3.test/${id}`, description: "Original summary", source: "e3.test", savedAt, status, projectId: null });
      await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnItems: [item("a", 3), item("b", 2), item("c", 1), item("hidden", 0, "done")],
        laterOnProjects: [], laterOnCovers: {}, laterOnActiveProject: "unfiled", laterOnFilterChosen: true, laterOnFilter: "unread",
        laterOnSettings: { language, theme, autoMarkRead: true } });
    }, { language, theme });
    const library = await context.newPage();
    await library.setViewportSize({ width: 1200, height: 800 });
    await library.goto(extension.url.replace("sidepanel.html", "library.html?from=sidepanel&project=unfiled&filter=unread"));
    await page.goto(extension.url);
    const cards = page.locator("#items .item"), link = page.locator('[data-id="a"] .open-item');
    await expect(cards).toHaveCount(3); await link.focus(); await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu"), entries = menu.getByRole("menuitem");
    await expect(entries.nth(0)).toBeFocused(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    const dialog = page.locator(".lod-root:not([hidden])"), title = dialog.locator('[data-field="title"]');
    await expect(title).toBeFocused(); await title.fill("E3 edited"); await dialog.locator(".lod-ok").click();
    await expect(page.locator('[data-id="a"] h2')).toHaveText("E3 edited");
    await expect(library.locator('#cardGrid [data-id="a"] h2')).toHaveText("E3 edited");
    await expect(link).toBeFocused();
    for (const width of [375, 640]) {
      await page.setViewportSize({ width, height: 800 });
      await link.click({ button: "right" }); await expect(menu).toBeVisible();
      const box = await menu.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(width - 7);
      await page.keyboard.press("End"); await expect(entries.nth(2)).toBeFocused();
      await page.keyboard.press("Escape"); await expect(link).toBeFocused(); await expect(menu).toHaveCount(0);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    // 从非链接的卡片边缘用原生鼠标发起排序，验证浏览器实际 dragstart/drop 链。
    const from = await page.locator('[data-id="c"]').boundingBox(), to = await page.locator('[data-id="a"]').boundingBox();
    await page.mouse.move(from.x + 3, from.y + 25); await page.mouse.down();
    await page.mouse.move(from.x + 15, from.y + 35, { steps: 5 }); await expect(page.locator(".card-drag-preview")).toHaveCount(1);
    await page.mouse.move(to.x + 30, to.y + 10, { steps: 12 }); await page.mouse.up();
    const order = () => cards.evaluateAll(elements => elements.map(element => element.dataset.id));
    await expect.poll(order).toEqual(["c", "a", "b"]);
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnOrder")).laterOnOrder.unfiled)).toEqual(["c", "a", "b", "hidden"]);
    await expect.poll(() => library.locator("#cardGrid .card").evaluateAll(elements => elements.map(element => element.dataset.id))).toEqual(["c", "a", "b"]);
    await page.reload(); await expect.poll(order).toEqual(["c", "a", "b"]);
    const article = await context.newPage(); await article.goto("https://e3.test/a"); await page.bringToFront();
    const pageCount = context.pages().length;
    await link.click();
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems.find(item => item.id === "a").status)).toBe("reading");
    expect(context.pages().length).toBe(pageCount); expect(page.url()).toBe(extension.url);
    await page.bringToFront(); await expect(page.locator('[data-id="a"]')).toHaveClass(/is-reading/);
    await link.focus(); await page.keyboard.press("Shift+F10"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
    await dialog.locator(".lod-cancel").click(); await expect(link).toBeFocused();
    await link.focus(); await page.keyboard.press("Shift+F10"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
    await dialog.locator(".lod-ok").click(); await expect(page.locator('[data-id="a"]')).toHaveCount(0);
    await page.reload(); await expect(cards).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath(`e3-${language}-${theme}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("待整理四档排序在全屏与侧栏一致，最近添加不受存储数组及移入位置影响", async ({ context, page, extension }) => {
  await extension.worker.evaluate(async () => {
    await chrome.storage.local.clear();
    const now = Date.now();
    const item = (id, age, source, projectId = null) => ({ id, savedAt: now - age, source, projectId,
      title: id, url: `https://example.test/${id}`, description: "Summary", status: "unread" });
    await chrome.storage.local.set({ laterOnOnboardingSeen: true,
      laterOnItems: [item("old", 3000, "m.test"), item("new", 1000, "z.test"), item("middle", 2000, "a.test"), item("moved", 4000, "p.test", "p")],
      laterOnProjects: [{ id: "p", name: "Project" }], laterOnActiveProject: "unfiled", laterOnFilter: "all", laterOnFilterChosen: true,
      laterOnOrder: { unfiled: ["old", "middle", "new"] }, laterOnSettings: { defaultSort: "custom", autoMarkRead: false, language: "zh-CN", theme: "light" }
    });
  });
  const library = await context.newPage();
  await library.setViewportSize({ width: 1200, height: 800 });
  await library.goto(extension.url.replace("sidepanel.html", "library.html?from=sidepanel&project=unfiled&filter=all"));
  await page.goto(extension.url);
  const panelCards = page.locator("#items .item"), libraryCards = library.locator("#cardGrid .card");
  const order = cards => cards.evaluateAll(nodes => nodes.map(node => node.dataset.id));
  const verify = async expected => {
    await expect.poll(() => order(panelCards)).toEqual(expected);
    await expect.poll(() => order(libraryCards)).toEqual(expected);
  };
  await verify(["old", "middle", "new"]);
  for (const [mode, expected] of Object.entries({ newest: ["new", "middle", "old"], oldest: ["old", "middle", "new"], source: ["middle", "old", "new"], custom: ["old", "middle", "new"] })) {
    await library.locator("#sortSelect").selectOption(mode);
    await verify(expected);
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnSettings")).laterOnSettings.defaultSort)).toBe(mode);
  }
  await library.locator("#sortSelect").selectOption("newest");
  await verify(["new", "middle", "old"]);
  await extension.worker.evaluate(async () => {
    const { laterOnItems: items } = await chrome.storage.local.get("laterOnItems");
    const moved = { ...items.find(item => item.id === "moved"), projectId: null };
    const added = { id: "added", title: "Added", url: "https://example.test/added", status: "unread", savedAt: Date.now(), source: "added.test" };
    await chrome.storage.local.set({ laterOnItems: [moved, ...items.filter(item => item.id !== "moved"), added] });
  });
  await verify(["added", "new", "middle", "old", "moved"]);
  await page.reload();
  await verify(["added", "new", "middle", "old", "moved"]);
  await library.locator("#sortSelect").selectOption("custom");
  await verify(["old", "middle", "new", "added", "moved"]);
});

for (const [language, theme] of [["zh-CN", "light"], ["en", "dark"]]) {
  test(`E2：后批定位、卡片键盘操作与封面降级 ${language}/${theme}`, async ({ context, page, extension }, testInfo) => {
    const requests = [];
    await context.route("https://i.ytimg.com/vi/e2/**", async route => {
      requests.push({ url: route.request().url(), referer: route.request().headers().referer });
      if (route.request().url().endsWith("mqdefault.jpg")) {
        await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="teal"/></svg>' });
      } else await route.fulfill({ status: 404, body: "missing" });
    });
    await extension.worker.evaluate(async ({ language, theme }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        laterOnOnboardingSeen: true, laterOnSettings: { language, theme, autoMarkRead: false },
        laterOnItems: Array.from({ length: 96 }, (_, index) => ({ id: `e2-${index}`, title: `Article ${index}`, description: "A saved article with a short summary.",
          source: "example.test", url: `https://example.test/e2/${index}`, savedAt: Date.now() - index * 1000, status: "unread",
          image: index === 70 ? "https://i.ytimg.com/vi/e2/maxresdefault.jpg" : "" })),
        laterOnProjects: [], laterOnCovers: {}, laterOnActiveProject: "unfiled", laterOnFilterChosen: true,
        laterOnFilter: "all", laterOnCurrentItem: "e2-70"
      });
    }, { language, theme });
    await page.goto(extension.url);
    const cards = page.locator("#items .item");
    await expect(cards).toHaveCount(96);
    await expect(page.locator('[data-id="e2-70"]')).toHaveClass(/is-current/);
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnLocateDiag")).laterOnLocateDiag?.inView)).toBe(true);
    const image = page.locator('[data-id="e2-70"] .thumb-img');
    await expect(image).toHaveAttribute("src", "https://i.ytimg.com/vi/e2/mqdefault.jpg");
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(requests.map(request => new URL(request.url).pathname.split("/").pop())).toEqual(["maxresdefault.jpg", "hq720.jpg", "hqdefault.jpg", "mqdefault.jpg"]);
    expect(requests.every(request => !request.referer)).toBe(true);
    const currentInView = () => page.evaluate(() => {
      const card = document.querySelector("#items .is-current").getBoundingClientRect();
      return card.top >= document.querySelector("header").getBoundingClientRect().bottom + 9 && card.bottom <= innerHeight + 1;
    });
    await expect.poll(currentInView).toBe(true);
    await page.setViewportSize({ width: 640, height: 800 });
    await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnCurrentItem: "e2-30" }));
    const card = page.locator('[data-id="e2-30"]');
    await expect(card).toHaveClass(/is-current/);
    await expect.poll(currentInView).toBe(true);
    const read = card.locator(".read-toggle");
    await read.focus(); await page.keyboard.press("Space");
    await expect(card).toHaveClass(/is-read/);
    await expect.poll(() => extension.worker.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems.find(item => item.id === "e2-30").status)).toBe("done");
    await expect(read).toBeFocused();
    await extension.worker.evaluate(async cover => {
      const { laterOnItems: items } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnItems: items.map(item => item.id === "e2-30" ? { ...item, title: "Updated article", source: "updated.test", image: "local://e2-30" } : item), laterOnCovers: { "e2-30": cover } });
    }, cover);
    await expect(card.locator("h2")).toHaveText("Updated article");
    await expect(card.locator(".source")).toHaveText("updated.test");
    await expect(read).toBeFocused();
    await expect.poll(() => card.locator(".thumb-img").evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`e2-${language}-${theme}.png`) });
  });
}

for (const colorScheme of ["light", "dark"]) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("外部脚本和样式尚未到达时，仍实际绘制骨架并隐藏正式内容", async ({ context, page }) => {
      const blocked = [];
      await context.route("https://lateron.test/**", async (route) => {
        const request = route.request();
        if (["script", "stylesheet"].includes(request.resourceType())) {
          blocked.push(route);
          return;
        }
        const file = path.basename(new URL(request.url()).pathname);
        const body = await fs.readFile(path.join(buildDir, file));
        await route.fulfill({ body, contentType: file.endsWith(".html") ? "text/html; charset=utf-8" : "image/png" });
      });
      try {
        await page.goto("https://lateron.test/sidepanel.html", { waitUntil: "commit" });
        await expect(page.locator("#bootSkeleton")).toBeVisible();
        await expect(page.locator("#appBody")).toBeHidden();
        await expect(page.locator("#bootTip")).toBeHidden();
        await expect(page.locator("body")).toHaveCSS("background-color", colorScheme === "dark" ? "rgb(22, 22, 26)" : "rgb(247, 246, 244)");
        await expect.poll(() => page.evaluate(() => performance.getEntriesByType("paint").some((entry) => entry.name === "first-contentful-paint"))).toBe(true);
        expect(blocked.length).toBeGreaterThan(0);
      } finally {
        await Promise.all(blocked.map((route) => route.abort()));
      }
    });

    test("实际扩展加载后样式生效，窄宽侧栏的封面与占位正确铺满", async ({ page, extension }) => {
      await seed(extension.worker, colorScheme);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(extension.url);
      const cards = page.locator("#items .item");
      await expect(cards).toHaveCount(2);
      await expect(page.locator("#bootSkeleton")).toHaveCount(0);
      await expect(page.locator("#appBody")).toBeVisible();
      await expect.poll(() => page.locator("link[data-boot-style]").evaluateAll((links) => links.every((link) => link.media === "all"))).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await expect.poll(() => page.locator('[data-id="cover"] .thumb-img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      for (const width of [375, 640]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(page.locator("body")).toHaveCSS("padding", "0px");
        const bounds = await page.evaluate(() => {
          const rect = (element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          };
          const thumb = document.querySelector('[data-id="cover"] .thumb');
          const box = thumb.getBoundingClientRect();
          return {
            viewport: innerWidth, scroll: document.documentElement.scrollWidth,
            header: rect(document.querySelector("header")),
            cards: [...document.querySelectorAll("#items .item")].map((card) => ({
              link: rect(card.querySelector(".open-item")), thumb: rect(card.querySelector(".thumb")),
              placeholder: rect(card.querySelector(".thumb-placeholder"))
            })),
            image: rect(thumb.querySelector(".thumb-img")),
            imageOnTop: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === thumb.querySelector(".thumb-img")
          };
        });
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.viewport);
        expect(bounds.header.x).toBe(0);
        expect(bounds.header.y).toBe(0);
        expect(bounds.header.width).toBe(width);
        for (const card of bounds.cards) {
          if (width < 620) {
            expect(Math.abs(card.thumb.height - card.link.height)).toBeLessThan(1);
            expect(card.link.height).toBeLessThan(160);
          } else {
            // Wide sidebars use vertical cards: cover above copy, rather than beside it.
            expect(card.thumb.width).toBe(card.link.width);
            expect(card.thumb.y).toBe(card.link.y);
            expect(card.thumb.width / card.thumb.height).toBeCloseTo(1.62, 2);
            expect(card.link.height).toBeLessThan(320);
          }
          expect(card.thumb.height).toBeGreaterThanOrEqual(92);
          expect(card.placeholder).toEqual(card.thumb);
        }
        expect(bounds.image).toEqual(bounds.cards[0].thumb);
        expect(bounds.imageOnTop).toBe(true);
      }
      expect(errors).toEqual([]);
    });
  });
}

test("真实删除入口经后台协调器持久化，重开后收藏和封面仍已删除", async ({ page, extension }) => {
  await seed(extension.worker, "light");
  await page.goto(extension.url);
  const card = page.locator('[data-id="cover"]');
  await expect(card).toBeVisible();
  await card.hover();
  await card.getByRole("button", { name: "删除网页", exact: true }).click();
  await page.locator(".lod-root").getByRole("button", { name: "删除", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => extension.worker.evaluate(async () => {
    const stored = await chrome.storage.local.get(["laterOnItems", "laterOnCovers"]);
    return { ids: stored.laterOnItems.map((item) => item.id), hasCover: Object.hasOwn(stored.laterOnCovers, "cover") };
  })).toEqual({ ids: ["placeholder"], hasCover: false });
  await page.reload();
  await expect(page.locator("#items .item")).toHaveCount(1);
  await expect(page.locator('[data-id="placeholder"]')).toBeVisible();
  await expect(card).toHaveCount(0);
});

for (const [language, theme] of [["zh-CN", "light"], ["en", "dark"]]) {
  test(`E1 原生控件、键盘与收藏库双向同步：${language}/${theme}`, async ({ context, page, extension }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await extension.worker.evaluate(async ({ language, theme }) => {
      await chrome.storage.local.clear();
      const item = (id, projectId, status) => ({ id, projectId, status, title: `Beta ${id}`, url: `https://example.test/${id}`, description: "Summary", source: "example.test", image: "", favicon: "", savedAt: Date.now() });
      await chrome.storage.local.set({ laterOnOnboardingSeen: true,
        laterOnItems: [item("a", "p", "unread"), item("b", "q", "reading"), item("c", "q", "done"), item("u", null, "unread")],
        laterOnProjects: [{ id: "p", name: "Project P" }, { id: "q", name: "Project Q" }],
        laterOnActiveProject: "p", laterOnFilter: "unread", laterOnFilterChosen: true,
        laterOnSettings: { language, theme, autoMarkRead: false }, laterOnCovers: {} });
    }, { language, theme });
    const library = await context.newPage();
    await library.setViewportSize({ width: 1200, height: 800 });
    library.on("pageerror", error => errors.push(error.message));
    await library.goto(extension.url.replace("sidepanel.html", "library.html?from=sidepanel&project=p&filter=unread"));
    await expect(library.locator('#cardGrid .card[data-id="a"]')).toBeVisible();
    await page.goto(extension.url);
    const cards = page.locator("#items .item");
    await expect(cards).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute("lang", language);
    await expect(page.locator('html')).toHaveAttribute("data-theme", theme);
    await expect(page.locator('[data-project="q"] strong')).toHaveText("2");
    const search = page.locator("#searchInput");
    await search.focus();
    await search.fill("  EXAMPLE.TEST/B  ");
    await expect(cards).toHaveCount(1);
    await expect(page.locator('[data-id="b"]')).toBeVisible();
    await expect(search).toBeFocused();
    const done = page.locator('.filter[data-filter="done"]');
    await done.focus(); await page.keyboard.press("Space");
    await expect(cards).toHaveCount(0);
    await expect(done).toHaveAttribute("aria-pressed", "true");
    await expect(done).toBeFocused();
    await search.fill("");
    const project = page.locator('[data-project="q"]');
    await project.focus(); await page.keyboard.press("Enter");
    await expect(page.locator('[data-id="c"]')).toBeVisible();
    await expect(project).toBeFocused();
    await expect(library.locator('.project-nav[data-project="q"]')).toHaveClass(/active/);
    await expect(library.locator('#cardGrid .card[data-id="c"]')).toBeVisible();
    await library.locator('.nav-item[data-filter="unread"]').click();
    await expect(page.locator('[data-id="b"]')).toBeVisible();
    await expect(page.locator('.filter[data-filter="unread"]')).toHaveAttribute("aria-pressed", "true");
    expect(await extension.worker.evaluate(async () => {
      const { laterOnFilter, laterOnActiveProject } = await chrome.storage.local.get(["laterOnFilter", "laterOnActiveProject"]);
      return { filter: laterOnFilter, project: laterOnActiveProject };
    })).toEqual({ filter: "unread", project: "q" });
    for (const width of [375, 640]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`e1-${language}-${theme}.png`), fullPage: true });
    await page.reload();
    await expect(page.locator('[data-id="b"]')).toBeVisible();
    await expect(project).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });
}
