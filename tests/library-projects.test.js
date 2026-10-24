const assert = require("node:assert/strict");
const rules = require("./helpers/load-module.cjs")("src/library/shared.ts");
const freeze = value => {
  if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};
const collection = freeze({
  projects: [{ id: "p", name: "Project", pinned: true, coverPick: ["missing", "done", "broken"] },
    { id: "empty", name: "Empty" }, { id: "done", name: "Finished" },
    { id: "archive", name: "Archive", archived: true }],
  items: [{ id: "a", projectId: "p", status: "unread", source: "Site A", savedAt: 30, image: "" },
    { id: "b", projectId: "p", status: "reading", source: "Site A", savedAt: 20, image: "https://example.com/b.jpg" },
    { id: "done", projectId: "p", status: "done", source: "Site B", savedAt: 10, image: "local://cover" },
    { id: "broken", projectId: "p", status: "unread", savedAt: 9, image: "local://missing" },
    { id: "d", projectId: "done", status: "done", savedAt: 8 },
    { id: "x", projectId: "archive", status: "done", savedAt: 7 }],
  covers: { cover: "data:image/png;base64,AAAA" }
});
const ids = values => values.map(value => value.id);
assert.deepEqual(ids(rules.projectNavigation(collection)), ["p", "empty", "done"]);
assert.deepEqual(rules.projectNavigation(collection)[0], { id: "p", name: "Project", pinned: true, count: 4, cover: collection.covers.cover });
assert.deepEqual(ids(rules.boardGroups(collection, "unread", false)), ["p", "empty"]);
assert.deepEqual(ids(rules.boardGroups(collection, "done", false)), ["p", "empty", "done"]);
const [group] = rules.boardGroups(collection, "unread", false);
assert.deepEqual(ids(group.items), ["a", "b", "broken"]);
assert.deepEqual(ids(group.own), ["a", "b", "done", "broken"]);
assert.deepEqual(ids(rules.boardCoverItems(group, collection.covers)), ["done"], "Read filter does not change the picked cover");
assert.deepEqual(ids(rules.boardCoverItems({ ...group, pick: [] }, collection.covers)), ["b", "done", "a"], "Automatic covers favor resolvable images, then newest pages");
assert.deepEqual(ids(rules.boardGroups(collection, "unread", true)), ["archive"], "Archived projects stay visible with no matching unread items");
assert.equal(rules.projectCoverFor({ ...collection, projects: [{ ...collection.projects[0], cover: "custom" }] }, "p"), "custom");
assert.equal(rules.projectCoverFor({ ...collection, covers: {} }, "p"), "https://example.com/b.jpg", "Broken local pointers do not hide usable fallback covers");
assert.equal(rules.projectCoverFor(collection, "empty"), "");
const translate = (key, values) => ({ mainlyFrom: `来自 ${values?.sources}`, updatedAt: `更新 ${values?.time}`,
  emptyBoardNote: "空项目", emptyCollection: "无收藏", notFinished: "没看完", allRead: "全已读" })[key] ?? key;
assert.deepEqual(rules.boardNote(group, translate, value => String(value), false), { text: "来自 Site A、Site B · 更新 30", auto: true });
assert.deepEqual(rules.boardNote({ ...group, note: "  Written note  " }, translate, String, false), { text: "Written note", auto: false });
assert.equal(rules.boardMeta(group, translate, false), "4 篇 · 3 没看完", "Metadata describes the complete project");
assert.equal(rules.boardMeta({ ...group, own: [] }, translate, false), "无收藏");
assert.equal(rules.boardNote({ ...group, own: [] }, translate, String, false).text, "空项目");

const mixedSources = freeze([
  { source: " Site B ", savedAt: 1 }, { source: "Site A", savedAt: 2 },
  { source: "Site B", savedAt: 3 }, { source: " Site A ", savedAt: 4 },
  { source: "Site C", savedAt: 5 }, { source: "  ", savedAt: 6 }, { savedAt: 7 }
]);
assert.deepEqual(rules.boardNote({ ...group, own: mixedSources }, translate, String, false),
  { text: "来自 Site B、Site A · 更新 7", auto: true }, "Trim sources, ignore blanks and preserve first-seen order for equal counts");
assert.equal(rules.boardNote({ ...group, own: mixedSources }, translate, String, true).text,
  "来自 Site B, Site A · 更新 7", "English joins the same top sources with commas");

const manySources = freeze(Array.from({ length: 5000 }, (_, index) => ({ source: `site-${index}.example`, savedAt: index + 1 })));
const largeProject = freeze({ ...group, own: [...manySources,
  { source: "site-4999.example", savedAt: 5001 }, { source: " site-4999.example ", savedAt: 5002 },
  { source: "site-4000.example", savedAt: 5003 }] });
assert.deepEqual(rules.boardNote(largeProject, translate, String, false),
  { text: "来自 site-4999.example、site-4000.example · 更新 5003", auto: true },
  "Large projects count every source and retain the most frequent sources and latest save without mutating input");
console.log("PASS project projections, archive/filter semantics, stable covers and metadata with immutable inputs");
