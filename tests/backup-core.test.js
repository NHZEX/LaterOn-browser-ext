const assert = require("node:assert/strict");
const core = require("../src/backup/core.ts");

assert.equal(globalThis.LaterOnBackup, undefined, "Importing the pure module does not install a global");
const document = (data) => ({ format: core.FORMAT, version: core.VERSION, exportedAt: "2026-10-23T00:00:00Z", data });
const fixture = () => ({
  items: [{ id: "article", url: "https://example.com/a%2Fb?q=C++&b=2#/article/1", savedAt: 1, projectId: "project", ignored: "drop" }],
  projects: [{ id: "project", name: "Project", createdAt: 1, ignored: "drop" }],
  covers: {}, order: { all: ["article"], project: ["article"] }, readingPositions: { article: 321 }
});
const original = document(fixture());
const before = structuredClone(original);
const parsed = core.parse(original);
assert.equal(parsed.items[0].url, original.data.items[0].url, "Stored URLs retain escapes, plus signs and hash routes");
assert.equal(parsed.items[0].status, "unread");
assert.equal(parsed.items[0].read, false);
assert.equal(parsed.items[0].doneAt, null);
assert(!Object.hasOwn(parsed.items[0], "ignored"));
assert(!Object.hasOwn(parsed.projects[0], "ignored"));
assert(!Object.hasOwn(parsed.items[0], "image"), "Absent optional fields stay absent");
assert(!Object.hasOwn(parsed.projects[0], "cover"));
assert.deepEqual(original, before, "Validation does not mutate the imported file");
assert.deepEqual(core.counts(parsed), { items: 1, projects: 1, covers: 0, positions: 1 });
assert.deepEqual(core.parse(core.create(core.toStorage(parsed), "1.69.3", original.exportedAt, { includeImages: true })), core.fromStorage(core.toStorage(parsed)));

for (const value of [null, [], "backup", 1, false, {}, { ...original, version: 99 }]) {
  assert.throws(() => core.parse(value), /^Error: UNSUPPORTED_BACKUP$/);
}
const invalidCases = [
  [data => { data.items = null; }, "items"],
  [data => { data.items = [null]; }, "items[0]"],
  [data => { data.items[0].savedAt = "1"; }, "items[0]"],
  [data => { data.items[0].image = null; }, "items[0].image"],
  [data => { data.items[0].read = undefined; }, "items[0].read"],
  [data => { data.items[0].status = "invalid"; }, "items[0].status"],
  [data => { data.items[0].doneAt = "1"; }, "items[0].doneAt"],
  [data => { data.items[0].projectId = "missing"; delete data.order.project; }, "items.projectId"],
  [data => { data.items.push(data.items[0]); }, "items.duplicateId"],
  [data => { data.projects[0].coverPick = [1]; }, "projects[0].coverPick"],
  [data => { data.projects[0].coverPick = ["missing"]; }, "projects.coverPick"],
  [data => { data.projects[0].pinFrom = 1.5; }, "projects[0].pinFrom"],
  [data => { data.covers = []; }, "covers"],
  [data => { data.covers.article = "https://example.com/cover.png"; }, "covers.article"],
  [data => { data.order.all = [1]; }, "order.all"],
  [data => { data.order.all = ["article", "article"]; }, "order.all"],
  [data => { data.order = JSON.parse('{"__proto__":[]}'); }, "order.key"],
  [data => { data.readingPositions.article = "321"; }, "readingPositions.article"]
];
for (const [alter, path] of invalidCases) {
  const invalid = fixture();
  alter(invalid);
  const snapshot = structuredClone(invalid);
  assert.throws(() => core.parse(document(invalid)), { message: `INVALID_BACKUP:${path}` });
  assert.deepEqual(invalid, snapshot, "Rejected data stays untouched");
}

const legacy = fixture();
legacy.items[0].image = "data:image/png;base64,AAAA";
const legacyDocument = { type: "lateron-backup", version: 2, exportedAt: 1, ...legacy };
const legacyBefore = structuredClone(legacyDocument);
const legacyParsed = core.parse(legacyDocument);
assert.equal(legacyParsed.items[0].image, "local://article");
assert.equal(legacyParsed.covers.article, legacy.items[0].image);
assert.deepEqual(legacyParsed.readingPositions, {});
assert.deepEqual(legacyDocument, legacyBefore);
assert.throws(() => core.parse({ ...legacyDocument, covers: [] }), { message: "INVALID_BACKUP:legacy.covers" });

console.log("PASS pure backup module: unknown inputs, field whitelist, precise validation errors, absent fields and legacy normalization");
