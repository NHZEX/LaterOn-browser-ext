const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSync } = require("esbuild");

const { outputFiles } = buildSync({ entryPoints: ["src/sync/state.ts"], bundle: true, format: "cjs", write: false });
const stateModule = { exports: {} };
new Function("module", "exports", outputFiles[0].text)(stateModule, stateModule.exports);
const { mergeSyncStates, hashSyncState } = stateModule.exports;

const url = "https://example.test/article";
const revision = { wallTime: 123, logical: 0, deviceId: "e17060f5-2847-418d-ac73-9a4c4630a68f" };
const member = (id, title) => ({ id, url, savedAt: 123,
  title: { value: title, revision, manual: true }, description: { value: "", revision, manual: false } });
const add = member => ({ members: [member], deletedIds: [] });
const remove = (...deletedIds) => ({ members: [], deletedIds });
const permutations = values => values.length < 2 ? [values] : values.flatMap((value, index) =>
  permutations(values.filter((_, other) => other !== index)).map(order => [value, ...order]));

test("同 URL 的独立成员乱序投递和重放后，只删除已知 ID 并保留 B 的原字段及修订", async () => {
  const first = member("A", "Title from A");
  const second = { ...member("B", "Title from B"), description: { value: "B's own notes",
    revision: { ...revision, logical: 1 }, manual: true } };
  const expected = { members: [second], deletedIds: ["A"] };
  const expectedHash = await hashSyncState(expected);
  assert.deepEqual(mergeSyncStates(add(first), add(second)).members, [first, second]);
  for (const order of permutations([add(first), add(second), remove("A")])) {
    const result = order.reduce(mergeSyncStates, remove());
    assert.deepEqual(result, expected);
    const replay = mergeSyncStates(mergeSyncStates(result, add(first)), add(second));
    assert.deepEqual(replay, expected);
    assert.equal(await hashSyncState(replay), expectedHash);
  }
  const recollected = member("C", "Collected again");
  assert.deepEqual(mergeSyncStates(mergeSyncStates(expected, remove("B")), add(recollected)),
    { members: [recollected], deletedIds: ["A", "B"] });
});

test("内容指纹仅由规范化同步状态决定，包含修订和删除，但不含排列及本机字段", async () => {
  const first = member("A", "A"), second = member("B", "B");
  const state = { members: [first, second], deletedIds: ["C", "D"] };
  const expected = await hashSyncState(state);
  assert.match(expected, /^[0-9a-f]{64}$/);
  assert.equal(await hashSyncState({ seq: 2, publishedAt: 831, laterOnOverrideLog: ["local"],
    members: [{ ...second, canonicalId: "A", localCover: "cover" }, first], deletedIds: ["D", "C"] }), expected);
  assert.notEqual(await hashSyncState({ ...state, deletedIds: ["C"] }), expected);
  assert.notEqual(await hashSyncState({ ...state, members: [first, { ...second,
    title: { ...second.title, revision: { ...revision, logical: 1 } } }] }), expected);
});
