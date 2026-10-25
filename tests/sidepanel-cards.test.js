const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPanelPage: page, makeItem, makeStore } = require("./helpers/panel-page.cjs");
const ids = env => [...env.document.querySelectorAll("#items .item")].map(element => element.dataset.id);

test("Vue 卡片原地更新全部内容、焦点和阅读标识，不依赖自身广播", async t => {
  const id = 'quote"[]:卡片';
  const original = makeItem({ id, favicon: "https://old.test/icon.png", image: "https://old.test/cover.png" });
  const env = page(t, { store: makeStore([original]) });
  await env.until(() => env.item(id), "原生卡片");
  const card = env.item(id), read = card.querySelector(".read-toggle");
  assert.equal(card.querySelector(".thumb-img").getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(card.querySelector(".meta img").getAttribute("referrerpolicy"), "no-referrer");
  read.focus();
  env.failNextWrite(); env.click(read);
  await env.until(() => env.document.querySelector("#status").textContent.includes("失败"), "写入失败");
  assert.equal(card.classList.contains("is-read"), false);
  env.click(read);
  await env.until(() => env.store.laterOnItems[0].status === "done", "重试持久化");
  assert.equal(env.count(), 0, "默认未读筛选立即移除已完成卡片");
  env.click(env.document.querySelector('[data-filter="all"]')); await env.flush();
  const updatedCard = env.item(id), button = updatedCard.querySelector(".read-toggle");
  button.focus();
  updatedCard.querySelector(".meta img").dispatchEvent(new env.window.Event("error")); await env.flush();
  assert.equal(updatedCard.querySelector(".meta img").style.visibility, "hidden");
  env.broadcast({ laterOnItems: [{ ...env.store.laterOnItems[0], title: "新标题", description: "新摘要", source: "new.test",
    url: "https://new.test/article", favicon: "https://new.test/icon.png", savedAt: env.window.Date.now() - 2 * 86400000,
    image: `local://${id}`, status: "reading" }], laterOnCovers: { [id]: "data:image/png;base64,YQ==" }, laterOnCurrentItem: id });
  await env.flush();
  assert.equal(env.item(id), updatedCard, "keyed 节点复用");
  assert.equal(env.document.activeElement, button, "外部刷新保留焦点");
  assert.equal(updatedCard.querySelector("h2").textContent, "新标题");
  assert.equal(updatedCard.querySelector(".description").textContent, "新摘要");
  assert.equal(updatedCard.querySelector(".source").textContent, "new.test");
  assert.equal(updatedCard.querySelector("time").textContent, "2 天前");
  assert.equal(updatedCard.querySelector(".open-item").href, "https://new.test/article");
  assert.equal(updatedCard.querySelector(".meta img").style.visibility, "");
  assert.equal(updatedCard.querySelector(".thumb-img").getAttribute("src"), "data:image/png;base64,YQ==");
  assert.equal(updatedCard.classList.contains("is-reading"), true);
  assert.equal(updatedCard.classList.contains("is-current"), true);
  await env.window.LaterOnI18n.setLanguage("en");
  await env.until(() => updatedCard.querySelector("time").textContent === "2 days ago", "卡片随语言原地更新");
  assert.equal(button.getAttribute("aria-label"), env.window.LaterOnI18n.t("readButton"));
  assert.equal(updatedCard.dataset.currentLabel, env.window.LaterOnI18n.t("currentReading"));
  assert.equal(env.item(id), updatedCard);
  assert.equal(env.document.activeElement, button);
  env.broadcast({ laterOnCurrentItem: null, laterOnItems: [{ ...env.store.laterOnItems[0], url: "javascript:alert(1)", image: "" }] });
  await env.flush();
  assert.equal(updatedCard.classList.contains("is-current"), false);
  assert.equal(updatedCard.querySelector(".open-item").getAttribute("href"), "#");
  assert.equal(updatedCard.querySelector(".thumb-img"), null);
  assert.ok(updatedCard.querySelector(".thumb-logo"));
});

test("卡片封面逐级降级，耗尽后显示占位；后续换图重新加载", async t => {
  const env = page(t, { store: makeStore([makeItem({ image: "https://i.ytimg.com/vi/video/maxresdefault.jpg?x=1" })]) });
  await env.until(() => env.item("fresh")?.querySelector(".thumb-img"), "封面");
  for (const name of ["hq720", "hqdefault", "mqdefault"]) {
    env.item("fresh").querySelector(".thumb-img").dispatchEvent(new env.window.Event("error")); await env.flush();
    assert.equal(env.item("fresh").querySelector(".thumb-img").src, `https://i.ytimg.com/vi/video/${name}.jpg`);
  }
  env.item("fresh").querySelector(".thumb-img").dispatchEvent(new env.window.Event("error")); await env.flush();
  assert.equal(env.item("fresh").querySelector(".thumb-img"), null);
  assert.ok(env.item("fresh").querySelector(".thumb-placeholder"));
  env.broadcast({ laterOnItems: [makeItem({ image: "https://new.test/cover.png" })] }); await env.flush();
  assert.equal(env.item("fresh").querySelector(".thumb-img").src, "https://new.test/cover.png");
});

test("首批恰好八张，过期空闲任务和卸载不能复活旧列表", async t => {
  const items = Array.from({ length: 160 }, (_, index) => makeItem({ id: `n-${index}`, status: index % 2 ? "done" : "unread" }));
  let diagnosedCards;
  const env = page(t, { store: { ...makeStore(items), laterOnFilterChosen: true, laterOnFilter: "all" }, setup(window) {
    const set = window.chrome.storage.local.set;
    window.chrome.storage.local.set = async patch => {
      if (patch.laterOnPanelDiag) diagnosedCards = window.document.querySelectorAll("#items .item").length;
      return set(patch);
    };
  } });
  await env.frame(); await env.frame();
  assert.equal(env.count(), 8);
  assert.equal(diagnosedCards, 8, "首屏诊断写入时已提交真实卡片");
  await env.idleTurn(); assert.equal(env.count(), 16);
  const stale = env.pendingIdle(); assert.ok(stale.length);
  env.click(env.document.querySelector('[data-filter="done"]')); await env.flush();
  const filteredCount = env.count();
  stale.forEach(callback => callback()); await env.flush();
  assert.equal(env.count(), filteredCount, "取消后的旧回调不推进新批次");
  assert.ok(ids(env).every(id => Number(id.slice(2)) % 2));
  await env.until(() => env.count() === 80, "已读批次完成");
  env.click(env.document.querySelector('[data-filter="unread"]')); await env.flush();
  const unmounted = env.pendingIdle(); assert.ok(unmounted.length);
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  unmounted.forEach(callback => callback()); await env.flush(); await env.frame();
  assert.equal(env.count(), 0, "卸载移除 Vue 卡片并取消续画");
  assert.equal(env.document.querySelector("#emptyState"), null);
});

test("已有目标也必须等后批铺完再定位；定位请求提升空闲批次，切换目标取消旧重试", async t => {
  const items = Array.from({ length: 80 }, (_, index) => makeItem({ id: `n-${index}` }));
  const scrolls = [];
  const env = page(t, { store: makeStore(items), setup(window) {
    window.chrome.tabs.query = async () => [];
    let scrollY = 0;
    Object.defineProperty(window, "scrollY", { get: () => scrollY });
    Object.defineProperty(window, "innerHeight", { value: 600 });
    Object.defineProperty(window.document.documentElement, "scrollHeight", { get: () => 200 + window.document.querySelectorAll("#items .item").length * 150 });
    window.Element.prototype.getBoundingClientRect = function() {
      if (this.matches("header")) return { bottom: 64 };
      const index = [...window.document.querySelectorAll("#items .item")].indexOf(this);
      return { top: 200 + index * 150 - scrollY, bottom: 340 + index * 150 - scrollY, height: 140 };
    };
    window.scrollTo = options => { scrolls.push({ ...options, count: window.document.querySelectorAll("#items .item").length }); if (options.behavior !== "smooth") scrollY = options.top; };
  } });
  await env.frame(); await env.frame(); assert.equal(env.count(), 8);
  env.broadcast({ laterOnCurrentItem: "n-6" }); await env.flush();
  for (let turn = 0; turn < 20 && env.count() < 80; turn++) { assert.deepEqual(scrolls, []); await env.frame(); }
  assert.equal(env.count(), 80);
  await env.frame();
  assert.equal(scrolls[0].count, 80);
  assert.equal(scrolls[0].behavior, "smooth");
  assert.equal(env.item("n-6").classList.contains("is-current"), true);
  env.broadcast({ laterOnCurrentItem: "n-70" }); await env.flush(); await env.frame();
  await env.clock.tickAsync(900); await env.flush();
  assert.equal(env.store.laterOnLocateDiag.itemId, "n-70");
  assert.equal(env.store.laterOnLocateDiag.inView, true);
  assert.equal(env.item("n-6").classList.contains("is-current"), false);
  assert.equal(env.item("n-70").classList.contains("is-current"), true);
  assert.equal(scrolls.at(-1).behavior, "auto", "丢失平滑滚动后瞬时补正");
  const before = scrolls.length;
  env.broadcast({ laterOnCurrentItem: "n-60" }); await env.flush(); await env.frame();
  env.window.dispatchEvent(new env.window.Event("pagehide"));
  const after = scrolls.length;
  assert.ok(after >= before);
  await env.clock.tickAsync(1000); await env.frame();
  assert.equal(scrolls.length, after, "卸载取消定位复查");
});
