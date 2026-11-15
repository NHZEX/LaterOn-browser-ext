const assert = require("node:assert/strict");
const { buildPickerSaveContext } = require("./helpers/load-module.cjs")("src/collection/picker-save-context.ts");
const { buildPayload } = require("./helpers/load-module.cjs")("src/collection/picker.ts");

const tab = (url, title = "网页") => ({ url, title });
const saved = (url, projectId, id = url) => ({ id, url, projectId, title: "已保存网页" });

{
  const result = buildPickerSaveContext(
    [tab("https://a.test/one"), tab("https://b.test/two")],
    [saved("https://a.test/one", "work"), saved("https://b.test/two", "work")],
    [{ id: "work", name: "工作" }, { id: "other", name: "其他项目" }]
  );
  assert.deepEqual(result.saveContext, {
    total: 2, savedCount: 2, newCount: 0,
    groups: [{ projectId: "work", projectName: "工作", count: 2 }],
    sameProjectId: "work"
  });
  assert.equal(result.matchedCounts.get("work"), 2);
  assert.ok(result.pages.every((page) => page.saved && page.projectName === "工作"));
}

{
  const result = buildPickerSaveContext(
    [tab("https://a.test/one"), tab("https://new.test/three")],
    [saved("https://a.test/one", "work")],
    [{ id: "work", name: "工作" }]
  );
  assert.equal(result.saveContext.newCount, 1);
  assert.equal(result.saveContext.savedCount, 1);
  assert.equal(result.saveContext.sameProjectId, null);
  assert.equal(result.pages[1].saved, false);
  assert.equal("projectId" in result.pages[1], false);
}

{
  const result = buildPickerSaveContext(
    [tab("https://a.test/one"), tab("https://c.test/three")],
    [saved("https://a.test/one", "work"), saved("https://c.test/three", "other")],
    [{ id: "work", name: "工作" }, { id: "other", name: "其他项目" }]
  );
  assert.equal(result.saveContext.groups.length, 2);
  assert.equal(result.saveContext.sameProjectId, null);
}

{
  const result = buildPickerSaveContext(
    [tab("https://a.test/one"), tab("https://b.test/two")],
    [saved("https://a.test/one", null), saved("https://b.test/two", "")],
    []
  );
  assert.equal(result.saveContext.sameProjectId, "");
  assert.deepEqual(result.saveContext.groups, [{ projectId: "", projectName: "等待整理", count: 2 }]);
}

{
  const archived = buildPickerSaveContext(
    [tab("https://a.test/one")],
    [saved("https://a.test/one", "archive")],
    [{ id: "archive", name: "归档资料", archived: true }]
  );
  assert.equal(archived.saveContext.groups[0].archived, true);
  assert.ok(archived.pages[0].projectName.includes("已归档"));
  assert.equal(archived.matchedCounts.get(""), undefined);

  const missing = buildPickerSaveContext(
    [tab("https://b.test/two")],
    [saved("https://b.test/two", "deleted")],
    []
  );
  assert.equal(missing.saveContext.groups[0].missing, true);
  assert.equal(missing.pages[0].projectName, "已删除的项目");
}

{
  const originals = [tab("https://same.test/paper?utm_source=new#two"), tab("https://www.same.test/paper#three")];
  const result = buildPickerSaveContext(
    originals,
    [
      saved("https://www.same.test/paper?utm_source=old#one", "work", "first"),
      saved("https://same.test/paper", "other", "second")
    ],
    [{ id: "work", name: "工作" }, { id: "other", name: "其他" }]
  );
  assert.equal(result.saveContext.total, 1);
  assert.equal(result.saveContext.savedCount, 1);
  assert.equal(result.pages.length, 2);
  assert.ok(result.pages.every((page) => page.projectId === "work"));
  assert.deepEqual(result.pages.map((page) => page.url), originals.map((page) => page.url));
}

{
  const shared = buildPayload({
    laterOnProjects: [{ id: "work", name: "工作" }],
    laterOnItems: [saved("https://a.test/one", "work"), saved("https://b.test/two", "work")],
    laterOnSettings: { language: "zh-CN" }
  }, { projectId: "", tabs: [tab("https://a.test/one"), tab("https://b.test/two")] });
  assert.equal(shared.selected, "work");
  assert.equal(shared.folders.find((folder) => folder.id === "work").matchedCount, 2);
  assert.equal(shared.saveContext.sameProjectId, "work");

  const mixed = buildPayload({
    laterOnProjects: [{ id: "work", name: "工作" }, { id: "archive", name: "归档", archived: true }],
    laterOnItems: [saved("https://a.test/one", "work"), saved("https://b.test/two", "archive")],
    laterOnSettings: { language: "zh-CN" }
  }, { projectId: "work", tabs: [tab("https://a.test/one"), tab("https://b.test/two")] });
  assert.equal(mixed.saveContext.sameProjectId, null);
  assert.equal(mixed.selected, "work", "Ordinary last-project selection remains when membership is mixed");
  assert.equal(mixed.folders.find((folder) => folder.id === "work").matchedCount, 1);
}

{
  const english = buildPickerSaveContext(
    [tab("https://a.test/one"), tab("https://b.test/two")],
    [saved("https://a.test/one", "archive"), saved("https://b.test/two", null)],
    [{ id: "archive", name: "Archive", archived: true }],
    true
  );
  assert.ok(english.pages[0].projectName.includes("(archived)"));
  assert.equal(english.pages[1].projectName, "Inbox");
}

console.log("PASS picker save context: shared project, mixed groups, unique URLs, archived/missing, bilingual");
