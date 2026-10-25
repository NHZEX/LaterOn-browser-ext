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
  await card.getByRole("button", { name: "删除", exact: true }).click();
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
