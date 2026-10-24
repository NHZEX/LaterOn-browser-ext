// Real sidebar + boot + coordinator; only browser boundaries are controlled.
// Single case: node --test --test-name-pattern="诊断" tests/panel-fast-open.test.js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage: page, makeItem, makeStore } = require("./helpers/panel-page.cjs");

const DATA_URL = "data:image/jpeg;base64,BIGCOVERDATA";
const cases = [
  ["存储未返回时先显示缓存，返回后更新页面和下次快照", async (t) => {
    const env = page(t, { pendingGet: true, cache: [makeItem({ id: "cached", title: "旧标题" })] });
    await env.until(() => env.item("cached"), "缓存首屏");
    assert.ok(env.item("cached").textContent.includes("旧标题"));
    assert.equal(env.item("fresh"), null);
    assert.equal(env.document.querySelector("#bootSkeleton"), null);
    assert.ok(env.calls.indexOf("storage") < env.calls.indexOf("cache"), "先发起异步读取，再读取同步缓存");
    env.releaseGet();
    await env.until(() => env.item("fresh") && !env.item("cached"), "真实存储替换缓存");
    await env.until(() => env.cached()?.[0]?.id === "fresh", "最新快照持久化");
    assert.equal(env.cached()[0].title, "存储里的新标题");
  }],
  ["无缓存时保留骨架，数据返回后撤掉全部启动占位", async (t) => {
    const env = page(t, { pendingGet: true });
    await env.frame();
    await env.frame();
    assert.ok(env.document.querySelector("#bootSkeleton"));
    assert.equal(env.count(), 0);
    env.releaseGet();
    await env.until(() => env.item("fresh"), "数据首屏");
    assert.equal(env.document.querySelector("#bootSkeleton"), null);
    assert.equal(env.document.querySelector("#bootTip"), null);
    assert.equal(env.document.body.classList.contains("booting"), false);
    await env.clock.tickAsync(1400);
    assert.equal(env.document.querySelector("#bootTip"), null, "完成启动后提示不会重新出现");
  }],
  ["旧 base64 封面通过真实协调器迁移并显示", async (t) => {
    const env = page(t, { store: makeStore([
      makeItem({ id: "old", image: DATA_URL }),
      makeItem({ id: "remote", image: "https://site.com/a.jpg" })
    ]) });
    await env.until(() => env.item("old")?.querySelector(".thumb-img"), "迁移封面显示");
    assert.equal(env.store.laterOnItems.find((item) => item.id === "old").image, "local://old");
    assert.equal(env.store.laterOnCovers.old, DATA_URL);
    assert.equal(env.store.laterOnItems.find((item) => item.id === "remote").image, "https://site.com/a.jpg");
    assert.equal(env.item("old").querySelector(".thumb-img").getAttribute("src"), DATA_URL);
  }],
  ...[false, true].map((broadcast) => [
    `取消删除不写入，确认后删除收藏及封面（存储广播${broadcast ? "开启" : "关闭"}）`, async (t) => {
      const env = page(t, { broadcast, store: {
        ...makeStore([makeItem({ image: "local://fresh" })]), laterOnCovers: { fresh: DATA_URL }
      } });
      await env.until(() => env.item("fresh"), "待删除卡片");
      env.click(env.item("fresh").querySelector(".delete"));
      await env.until(() => env.document.querySelector(".lod-root:not([hidden])"), "删除确认");
      env.click(env.document.querySelector(".lod-cancel"));
      await env.until(() => env.document.querySelector(".lod-root")?.hidden, "取消关闭");
      assert.ok(env.item("fresh"));
      assert.equal(env.store.laterOnItems.length, 1);
      assert.equal(env.store.laterOnCovers.fresh, DATA_URL);
      env.click(env.item("fresh").querySelector(".delete"));
      await env.until(() => env.document.querySelector(".lod-root:not([hidden])"), "再次删除确认");
      env.click(env.document.querySelector(".lod-ok"));
      await env.until(() => !env.item("fresh"), "确认删除后页面更新");
      assert.deepEqual(env.store.laterOnItems, []);
      assert.equal(Object.hasOwn(env.store.laterOnCovers, "fresh"), false);
    }
  ]),
  ["删除写入失败保留卡片和封面，允许从真实入口重试", async (t) => {
    const env = page(t, { store: {
      ...makeStore([makeItem({ image: "local://fresh" })]), laterOnCovers: { fresh: DATA_URL }
    } });
    await env.until(() => env.item("fresh"), "待删除卡片");
    env.failNextWrite();
    const confirmDelete = async () => {
      env.click(env.item("fresh").querySelector(".delete"));
      await env.until(() => env.document.querySelector(".lod-root:not([hidden])"), "确认弹窗");
      env.click(env.document.querySelector(".lod-ok"));
    };
    await confirmDelete();
    await env.until(() => env.document.querySelector("#status").textContent.includes("失败"), "操作失败提示");
    assert.ok(env.item("fresh"));
    assert.equal(env.store.laterOnItems.length, 1);
    assert.equal(env.store.laterOnCovers.fresh, DATA_URL);
    await confirmDelete();
    await env.until(() => !env.item("fresh"), "重试删除成功");
    assert.deepEqual(env.store.laterOnItems, []);
    assert.equal(Object.hasOwn(env.store.laterOnCovers, "fresh"), false);
  }],
  ["第一批先显示一屏，空闲任务续画全部收藏并保存非空预览", async (t) => {
    const items = Array.from({ length: 500 }, (_, index) => makeItem({ id: `n-${index}`, savedAt: 1_760_000_000_000 - index * 1000 }));
    const env = page(t, { store: makeStore(items), pendingGet: true });
    await env.frame();
    await env.frame();
    env.releaseGet();
    await env.until(() => env.count() > 0, "第一屏", { runIdle: false });
    const firstBatch = env.count();
    assert.ok(firstBatch > 0 && firstBatch < items.length, `首屏分批显示，实际 ${firstBatch} 张`);
    assert.equal(env.document.querySelector("#itemCount").textContent, "500 篇");
    await env.idleTurn();
    assert.ok(env.count() > firstBatch, "空闲调度确实推进渲染");
    await env.until(() => env.count() === items.length, "剩余卡片完整显示");
    assert.equal(new Set([...env.document.querySelectorAll("#items .item")].map((item) => item.dataset.id)).size, 500);
    await env.until(() => env.cacheWrites.length > 0, "快照写入");
    assert.equal(env.cached().length, 12, "预览应非空且限制为一屏");
    assert.deepEqual(env.cached().map((item) => item.id), items.slice(0, 12).map((item) => item.id));
  }],
  ["延迟绘制帧和存储返回后，诊断才写入且区分首屏与校准耗时", async (t) => {
    const env = page(t, { pendingGet: true, cache: [makeItem({ id: "cached" })] });
    assert.equal(env.store.laterOnPanelDiag, undefined);
    await env.frame(600);
    assert.equal(env.count(), 0, "第一帧仍保留骨架");
    await env.frame(600);
    assert.ok(env.item("cached"));
    assert.equal(env.store.laterOnPanelDiag, undefined, "存储未返回，不提前记录完成");
    await env.clock.tickAsync(2500);
    env.releaseGet();
    await env.until(() => env.store.laterOnPanelDiag, "诊断持久化");
    const diag = env.store.laterOnPanelDiag;
    for (const key of ["page", "cache", "paint", "data", "migrate", "other", "total", "firstPaint"]) {
      assert.ok(Number.isFinite(diag[key]) && diag[key] >= 0, `${key} 是有效耗时`);
    }
    assert.equal(diag.cacheHit, true);
    assert.equal(diag.items, 1);
    assert.equal(diag.localStorageOk, true);
    assert.equal(diag.page, 1200);
    assert.ok(diag.data >= 2500);
    assert.ok(diag.firstPaint < diag.total, "缓存首屏先于存储校准");
    assert.ok(Array.isArray(diag.slow));
  }],
  ...[0, 850, 2500, 9000].map((pageDelayMs) => [
    `页面准备 ${pageDelayMs}ms 的慢速横幅与诊断`, async (t) => {
      const env = page(t, { pageDelayMs });
      await env.until(() => env.store.laterOnPanelDiag, "启动诊断");
      const banner = env.document.querySelector("#slowBanner");
      assert.equal(banner.hidden, pageDelayMs <= 2000);
      assert.equal(env.store.laterOnPanelDiag.cacheHit, false);
      if (pageDelayMs > 2000) {
        assert.match(banner.textContent, /准备页面/);
        assert.match(banner.textContent, /Chrome 打开侧边栏/);
        assert.ok(banner.textContent.includes((env.store.laterOnPanelDiag.total / 1000).toFixed(1)));
      }
    }
  ]),
  ["同步缓存读取慢时记录原因，并停止后续快照写入", async (t) => {
    const env = page(t, { cache: [makeItem({ id: "cached" })], slowCacheMs: 500 });
    await env.until(() => env.store.laterOnPanelDiag, "缓存诊断");
    assert.equal(env.store.laterOnPanelDiag.cache, 500);
    assert.equal(env.store.laterOnPanelDiag.localStorageSlow, true);
    await env.clock.tickAsync(1000);
    assert.equal(env.cacheWrites.length, 0);
    assert.equal(env.cached()[0].id, "cached");
    assert.ok(env.item("fresh"), "慢缓存不妨碍真实数据展示");
  }],
  ["启动提示在 1.2 秒后出现，超 6 秒给出恢复建议", async (t) => {
    const env = page(t, { panel: false });
    const tip = env.document.querySelector("#bootTip");
    assert.equal(tip.hidden, true);
    await env.clock.tickAsync(1200);
    assert.equal(tip.hidden, true);
    await env.clock.tickAsync(200);
    assert.equal(tip.hidden, false);
    assert.equal(env.document.querySelector("#bootTipTime").textContent, "1.4 秒");
    await env.clock.tickAsync(4800);
    assert.match(env.document.querySelector("#bootTipHint").textContent, /关掉侧栏再打开/);
  }],
  ["主脚本未启动时，超 12 秒实际撤掉骨架并露出界面", async (t) => {
    const env = page(t, { panel: false });
    await env.clock.tickAsync(12000);
    assert.ok(env.document.querySelector("#bootSkeleton"));
    await env.clock.tickAsync(200);
    assert.equal(env.document.querySelector("#bootSkeleton"), null);
    assert.equal(env.document.querySelector("#bootTip"), null);
    assert.equal(env.document.body.classList.contains("booting"), false);
  }],
  ...[true, false].map((hasCache) => [
    `存储读取失败${hasCache ? "保留快照，重开可恢复" : "显示可恢复错误"}`, async (t) => {
      const cache = hasCache ? [makeItem({ id: "cached" })] : null;
      const env = page(t, { store: {}, cache, getError: "storage unavailable" });
      await env.until(() => env.document.querySelector("#status").textContent.includes(hasCache ? "显示上次打开的内容" : "关闭侧栏后重试"), "读取失败提示");
      if (hasCache) {
        assert.ok(env.item("cached"));
        await env.clock.tickAsync(1000);
        assert.equal(env.cached()[0].id, "cached", "错误不覆盖已有快照");
        const reopened = page(t, { cache: env.cached() });
        await reopened.until(() => reopened.item("fresh") && !reopened.item("cached"), "重开后成功校准");
        await reopened.until(() => reopened.cached()[0].id === "fresh", "恢复后的新快照");
      } else {
        assert.equal(env.count(), 0);
        assert.equal(env.document.querySelector("#bootSkeleton"), null);
      }
    }
  ])
];

// Deterministic reordering exposes fixture coupling without random CI failures.
const ordered = process.env.PANEL_TEST_ORDER === "reverse" ? cases.toReversed() : cases;
ordered.forEach(([name, run]) => test(name, { timeout: 10_000 }, run));
