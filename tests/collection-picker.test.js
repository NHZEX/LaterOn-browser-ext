const assert = require("node:assert/strict");
const { buildPayload } = require("../src/collection/picker.ts");

assert.equal(globalThis.LaterOnPicker, undefined, "Importing the pure module does not install a global");
assert.deepEqual(buildPayload({}, {}), {
  theme: "light", language: "zh-CN", selected: "", batchId: undefined, savedCount: 0,
  folders: [{ id: "", name: "等待整理", count: 0, cover: null }], pages: []
});

const stored = {
  laterOnProjects: [
    { id: "custom", name: "Custom", cover: "https://example.com/custom.png" },
    { id: "stored", name: "Stored" },
    { id: "linked", name: "Linked" },
    { id: "fallback", name: "Fallback" },
    { id: "empty", name: "Empty" },
    { id: "archived", name: "Archived", archived: true }
  ],
  laterOnItems: [
    { id: "inbox-one", projectId: null, image: "https://example.com/inbox.png" },
    { id: "inbox-two" },
    { id: "custom-item", projectId: "custom", image: "https://example.com/ignored.png" },
    { id: "stored-item", projectId: "stored", image: "https://example.com/remote.png" },
    { id: "linked-item", projectId: "linked", image: "local://legacy-cover" },
    { id: "missing-cover", projectId: "fallback", image: "local://missing" },
    { id: "fallback-item", projectId: "fallback", image: "https://example.com/fallback.png" },
    { id: "empty-item", projectId: "empty", image: "local://missing" },
    { id: "archived-item", projectId: "archived" },
    { id: "orphaned-item", projectId: "deleted" }
  ],
  laterOnSettings: { language: "en", theme: "dark" },
  laterOnCovers: {
    "custom-item": "data:image/png;base64,AA==",
    "stored-item": "data:image/png;base64,AQ==",
    "legacy-cover": "data:image/png;base64,Ag=="
  }
};
const url = "https://example.com/a%2Fb?q=C++&b=2#section";
const request = {
  projectId: "linked", batchId: "batch-fixed", savedCount: 4,
  tabs: [{ url, title: "Original title" }, { url: "https://example.com/untitled", title: "" }]
};
const before = structuredClone({ stored, request });
const expected = {
  theme: "dark", language: "en", selected: "linked", batchId: "batch-fixed", savedCount: 4,
  folders: [
    { id: "", name: "Inbox", count: 2, cover: "https://example.com/inbox.png" },
    { id: "custom", name: "Custom", count: 1, cover: "https://example.com/custom.png" },
    { id: "stored", name: "Stored", count: 1, cover: "data:image/png;base64,AQ==" },
    { id: "linked", name: "Linked", count: 1, cover: "data:image/png;base64,Ag==" },
    { id: "fallback", name: "Fallback", count: 2, cover: "https://example.com/fallback.png" },
    { id: "empty", name: "Empty", count: 1, cover: null }
  ],
  pages: [{ title: "Original title", url }, { title: "https://example.com/untitled", url: "https://example.com/untitled" }]
};
assert.deepEqual(buildPayload(stored, request), expected, "Project order, counts, cover priorities and batch metadata stay intact");
assert.deepEqual({ stored, request }, before, "The snapshot and batch request are not mutated");
for (const projectId of ["archived", "deleted"]) {
  assert.equal(buildPayload(stored, { projectId }).selected, "", "Unavailable projects fall back to Inbox");
}
assert.equal(buildPayload({ laterOnSettings: { language: "unknown" } }, {}).language, "zh-CN");

console.log("PASS native picker data: defaults, archived projects, covers, raw URLs and batch metadata");
