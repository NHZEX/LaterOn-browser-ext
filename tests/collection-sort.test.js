const assert = require("node:assert/strict");
const { test } = require("node:test");
const load = require("./helpers/load-module.cjs");
const library = load("src/library/shared.ts");
const panel = load("src/sidepanel/shared.ts");
const { createPanelPage, makeItem, makeStore } = require("./helpers/panel-page.cjs");

const items = Object.freeze([
  Object.freeze(makeItem({ id: "old", savedAt: 100, source: "m.test" })),
  Object.freeze(makeItem({ id: "new", savedAt: 300, source: "z.test" })),
  Object.freeze(makeItem({ id: "middle", savedAt: 200, source: "a.test" }))
]);
const expected = { newest: ["new", "middle", "old"], oldest: ["old", "middle", "new"], source: ["middle", "old", "new"], custom: ["old", "middle", "new"] };
const ids = env => [...env.document.querySelectorAll("#items .item")].map(card => card.dataset.id);

test("两页在存储数组乱序时仍遵循四档排序，且不修改原始集合", () => {
  const collection = Object.freeze({ items, projects: [], covers: {}, archivedProjectIds: new Set(), orders: { unfiled: ["missing", "old", "middle"] } });
  for (const [sort, order] of Object.entries(expected)) {
    assert.deepEqual(library.collectionCards(collection, { activeProject: "unfiled", query: "", filter: "all", sort }, collection.orders).visible.map(item => item.id), order);
    assert.deepEqual(panel.visiblePanelItems({ ...collection, sortMode: sort }, { project: "unfiled", query: "", filter: "all" }).map(item => item.id), order);
  }
  assert.deepEqual(items.map(item => item.id), ["old", "new", "middle"]);
  assert.deepEqual(panel.visiblePanelItems({ ...collection, sortMode: "invalid" }, { project: "unfiled", query: "", filter: "all" }).map(item => item.id), expected.newest);
  const malformed = { unfiled: {} };
  assert.deepEqual(panel.visiblePanelItems({ ...collection, orders: malformed, sortMode: "custom" }, { project: "unfiled", query: "", filter: "all" }).map(item => item.id), expected.newest);
});

for (const [sort, order] of Object.entries(expected)) test(`侧栏真实首屏恢复 ${sort}，外部排序切换立即重排并保留焦点`, async t => {
  const env = createPanelPage(t, { store: { ...makeStore(items), laterOnSettings: { defaultSort: sort }, laterOnOrder: { unfiled: ["old", "middle"] } } });
  await env.until(() => env.count() === 3, "侧栏卡片首屏");
  assert.deepEqual(ids(env), order);
  const card = env.item("old"), button = card.querySelector(".read-toggle");
  button.focus();
  env.broadcast({ laterOnSettings: { defaultSort: "newest" } }); await env.flush();
  assert.deepEqual(ids(env), expected.newest);
  assert.equal(env.item("old"), card);
  assert.equal(env.document.activeElement, button);
  const added = makeItem({ id: "added", savedAt: 400 });
  const moved = makeItem({ id: "moved", savedAt: 50 });
  env.broadcast({ laterOnItems: [moved, ...items, added] }); await env.flush();
  assert.deepEqual(ids(env), ["added", "new", "middle", "old", "moved"], "新增看首次收藏时间，移入条目也按原 savedAt 排序");
  assert.equal(env.store.laterOnItems[0].savedAt, 50, "排序不改写时间或存储数组");
  env.broadcast({ laterOnSettings: { defaultSort: "custom" } }); await env.flush();
  assert.deepEqual(ids(env), ["old", "middle", "added", "new", "moved"], "自定义模式继续保留手动顺序，未排序条目按时间补在后面");
});

test("乱序缓存先按最近添加显示，存储返回后恢复用户选择的最早添加", async t => {
  const env = createPanelPage(t, { pendingGet: true, cache: items,
    store: { ...makeStore(items), laterOnSettings: { defaultSort: "oldest" } } });
  await env.frame(); await env.frame();
  assert.deepEqual(ids(env), expected.newest);
  env.releaseGet();
  await env.until(() => ids(env).join() === expected.oldest.join(), "存储排序偏好校准");
});

test("无序存储写入的秒开快照仍保留最新十二条，排除归档且不改变原集合", async t => {
  const all = Array.from({ length: 20 }, (_, index) => makeItem({ id: `n-${index}`, savedAt: index }));
  all.push(makeItem({ id: "archived", savedAt: 999, projectId: "archived" }));
  const env = createPanelPage(t, { store: { ...makeStore(all), laterOnProjects: [{ id: "archived", archived: true }] } });
  await env.until(() => env.cacheWrites.length > 0, "缓存快照持久化");
  assert.deepEqual(env.cached().map(item => item.id), Array.from({ length: 12 }, (_, index) => `n-${19 - index}`));
  assert.deepEqual(env.store.laterOnItems.map(item => item.id), all.map(item => item.id));
});
