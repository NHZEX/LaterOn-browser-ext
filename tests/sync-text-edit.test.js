const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSync } = require("esbuild");

const { outputFiles } = buildSync({ stdin: { contents: `
  export * from "./src/sync/text-edit";
  export * from "./src/sync/state";
  export { mergeDuplicateMetadata } from "./src/background/duplicate-metadata";
`, resolveDir: process.cwd() }, bundle: true, format: "cjs", write: false });
const runtime = { exports: {} };
new Function("module", "exports", outputFiles[0].text)(runtime, runtime.exports);
const { editView, hashSyncState, initialSyncState, mergeDuplicateMetadata, mergeSyncStates, planSyncEdit, projectItemText,
  receiveSyncText, writeSyncEdit } = runtime.exports;

const firstDevice = "e17060f5-2847-418d-ac73-9a4c4630a68f";
const secondDevice = "ac4f72b0-8644-440e-8e03-8acfe4d1ff41";
const binding = (deviceId, state) => ({ deviceId, allocatedSeq: 0, binding: { bindingId: "binding", state } });
const url = "https://www.youtube.com/watch?v=123";
const original = { id: "A", url, savedAt: 1, title: "Original", description: "Summary" };

function write(meta, items, id, values, now) {
  return writeSyncEdit(meta, items, new Map([[id, values]]), now);
}

test("接收新收藏时从网址补来源和分类默认值，不重置已有收藏", () => {
  const local = { ...original, source: "Local source", status: "reading", projectId: "local-project", image: "local://A" };
  const previous = initialSyncState([local], firstDevice);
  const other = initialSyncState([{ ...original, id: "B", title: "Received" }], secondDevice);
  const received = receiveSyncText([local], previous, mergeSyncStates(previous, other), firstDevice, 123);
  const [existing, added] = received.items;
  assert.deepEqual(existing, local);
  assert.equal(added.title, "Received");
  assert.equal(added.source, "youtube.com");
  assert.equal(added.status, "unread");
  assert.equal(added.projectId, null);
});

test("同字段并发收敛，未发布手写败值只留本人；回放旧版本不会重记", async () => {
  const seed = initialSyncState([original], firstDevice);
  const first = write(binding(firstDevice, seed), [original], "A", { title: "Winning" }, 120);
  const second = write(binding(secondDevice, seed), [original], "A", { title: "Not yet published" }, 120);
  const left = first.meta.binding.state, right = second.meta.binding.state;
  const merged = mergeSyncStates(left, right), reversed = mergeSyncStates(right, left);
  assert.equal(await hashSyncState(merged), await hashSyncState(reversed));
  assert.equal(merged.members[0].title.value, "Winning");
  assert.deepEqual(receiveSyncText(first.items, left, merged, firstDevice, 123).records, []);
  const received = receiveSyncText(second.items, right, merged, secondDevice, 123);
  assert.deepEqual(received.records.map(({ value }) => value), ["Not yet published"]);
  assert.equal(received.items[0].textAuthors.title, firstDevice);
  assert.deepEqual(receiveSyncText(received.items, merged, mergeSyncStates(merged, right), secondDevice, 124).records, []);
  const restoredMeta = JSON.parse(JSON.stringify({ ...second.meta, binding: { ...second.meta.binding, state: merged } }));
  const restarted = write(restoredMeta, received.items, "A", { title: "After restart" }, 50);
  assert.deepEqual(restarted.meta.binding.state.members[0].title.revision, { wallTime: 120, logical: 1, deviceId: secondDevice });
  assert.equal(restarted.items[0].textAuthors, undefined);
});

test("合并卡片标题和摘要可各有来源，来源变化只拦受影响的字段", () => {
  const duplicate = { ...original, id: "B", savedAt: 2, title: "Second member", description: "B's summary" };
  const items = [original, duplicate];
  const meta = binding(firstDevice, initialSyncState(items, firstDevice));
  const editedTitle = write(meta, items, "B", { title: "Title from B" }, 110);
  const before = write(editedTitle.meta, editedTitle.items, "A", { description: "Summary from A" }, 111);
  const card = projectItemText(before.items[0], before.items, editView(before.meta));
  assert.equal(card.item.id, "A");
  assert.equal(card.basis.title.sourceId, "B");
  assert.equal(card.basis.description.sourceId, "A");
  const switched = write(before.meta, before.items, "A", { title: "New title from A" }, 112);
  const current = projectItemText(switched.items[0], switched.items, editView(switched.meta));
  const plan = planSyncEdit("A", current, card.basis, { title: "Stale draft", description: "Valid summary" }, 113);
  assert.deepEqual([...plan.changes], [["A", { description: "Valid summary" }]]);
  assert.deepEqual(plan.drafts.map(({ itemId, field, value }) => ({ itemId, field, value })), [{ itemId: "B", field: "title", value: "Stale draft" }]);
  const active = planSyncEdit("A", card, card.basis, { title: "Edit displayed title" }, 112);
  assert.deepEqual([...active.changes], [["B", { title: "Edit displayed title" }]]);
  const survivor = projectItemText(before.items[0], [before.items[0]], editView(before.meta));
  const removed = planSyncEdit("A", survivor, card.basis, { title: "Removed member draft", description: "Valid summary" }, 114);
  assert.deepEqual([...removed.changes], [["A", { description: "Valid summary" }]]);
  assert.equal(removed.drafts[0].itemId, "B");
});

test("删除恢复只收录本机手写字段，旧快照不能复活成员或重复写入", () => {
  const remote = { ...original, titleEdited: true, textAuthors: { title: secondDevice } };
  const automatic = { ...original, id: "B" };
  const base = initialSyncState([remote, automatic], firstDevice);
  const edited = write(binding(firstDevice, base), [remote, automatic], "A", { description: "Local notes" }, 110);
  const local = edited.meta.binding.state;
  const deleted = mergeSyncStates(local, { members: [], deletedIds: ["A", "B"] });
  const received = receiveSyncText(edited.items, local, deleted, firstDevice, 120);
  assert.deepEqual(received.items, []);
  assert.deepEqual([...received.removed], ["A", "B"]);
  assert.deepEqual(received.records.map(({ field, value }) => ({ field, value })), [{ field: "description", value: "Local notes" }]);
  const replayed = receiveSyncText(received.items, deleted, mergeSyncStates(deleted, local), firstDevice, 121);
  assert.deepEqual(replayed.items, []);
  assert.deepEqual(replayed.records, []);
});

test("重复收藏的自动刷新不进入已有修订，也不覆盖收到的手写值", async () => {
  const seed = initialSyncState([original], firstDevice);
  const refreshed = { ...original };
  assert.equal(mergeDuplicateMetadata(refreshed, { url, title: "Auto title", description: "Auto summary" }), true);
  assert.equal(refreshed.title, "Auto title");
  assert.equal(receiveSyncText([refreshed], seed, seed, firstDevice, 110).items[0].title, "Auto title");
  const remote = write(binding(secondDevice, seed), [original], "A", { title: "Manual from other device" }, 111).meta.binding.state;
  const merged = mergeSyncStates(seed, remote);
  const received = receiveSyncText([refreshed], seed, merged, firstDevice, 112);
  assert.equal(received.items[0].title, "Manual from other device");
  assert.deepEqual(received.records, []);
  const duplicate = { ...received.items[0] };
  mergeDuplicateMetadata(duplicate, { url, title: "Second auto title" });
  assert.equal(duplicate.title, "Manual from other device");
  const next = write(binding(secondDevice, merged), received.items, "A", { title: "Later remote edit" }, 113).meta.binding.state;
  assert.deepEqual(receiveSyncText([duplicate], merged, next, firstDevice, 114).records, []);
  assert.equal(await hashSyncState(mergeSyncStates(merged, seed)), await hashSyncState(merged));
});
