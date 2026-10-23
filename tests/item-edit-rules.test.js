const assert = require("node:assert/strict");
const vm = require("node:vm");
const rules = require("../src/collection/item-edit.ts");
const read = require("./helpers/read-runtime.cjs");

assert.equal(globalThis.LaterOnItemEdit, undefined, "Pure module imports have no browser or global side effects");
const context = vm.createContext({});
vm.runInContext(read("item-edit.js"), context, { filename: "item-edit.js" });

const cover = "data:image/png;base64,AAAA";
const item = Object.freeze({ title: "Original title", description: "Original summary", image: "local://cover-key" });
const covers = Object.freeze({ "cover-key": cover, unrelated: "https://example.com/other.png" });
const cases = [
  { label: "omitted fields keep existing content", values: {}, expected: {} },
  { label: "null fields keep existing content", values: { title: null, description: null, cover: null }, expected: {} },
  { label: "unchanged resolved local cover does not cause a write", values: { title: item.title, description: item.description, cover }, expected: {} },
  { label: "surrounding whitespace alone is not a change", values: { title: ` ${item.title}\n`, description: `\t${item.description} ` }, expected: {} },
  { label: "blank titles do not erase the title", values: { title: " \n\t " }, expected: {} },
  { label: "title edits only mark the title", values: { title: " New title " }, expected: { title: "New title", titleEdited: true } },
  { label: "summary edits only mark the summary", values: { description: " New summary " }, expected: { description: "New summary", descriptionEdited: true } },
  { label: "blank summaries use the existing placeholder", values: { description: " \n\t " }, expected: { description: "暂无摘要", descriptionEdited: true } },
  { label: "cover removal is an explicit edit", values: { cover: "" }, expected: { cover: "", imageEdited: true } },
  { label: "cover replacement only marks the image", values: { cover: "data:image/jpeg;base64,TkVX" }, expected: { cover: "data:image/jpeg;base64,TkVX", imageEdited: true } },
  { label: "combined edits retain each changed field", values: { title: " New ", description: " Summary ", cover: "" }, expected: {
    title: "New", titleEdited: true, description: "Summary", descriptionEdited: true, cover: "", imageEdited: true
  } }
];

for (const [name, api] of [["module", rules], ["classic entry", context.LaterOnItemEdit]]) {
  for (const { label, values, expected } of cases) {
    Object.freeze(values);
    assert.deepEqual(JSON.parse(JSON.stringify(api.buildEditPatch(item, values, cover))), expected, `${name}: ${label}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(api.buildEditPatch({ description: "暂无摘要" }, {}, ""))), {}, "Incomplete legacy records allow unchanged empty titles");
  assert.deepEqual(JSON.parse(JSON.stringify(api.buildEditPatch({ title: "Title", description: "暂无摘要" }, { cover: "" }, ""))), {}, "An already absent cover stays untouched");
  for (const value of ["", " \t\n", "暂无摘要", " 暂无摘要 ", "No summary", " no SUMMARY\n"]) {
    assert.equal(api.isEmptySummary(value), true, `${name}: recognizes empty or placeholder summaries`);
  }
  for (const value of [undefined, null, "A summary", "No summary available", "暂无摘要，稍后补充"]) {
    assert.equal(api.isEmptySummary(value), false, `${name}: does not hide real or missing legacy summaries`);
  }
  assert.equal(api.resolveImage(item, covers), cover, "Resolve the pointer key, not the item ID");
  assert.equal(api.resolveImage({ image: "local://missing" }, covers), "");
  assert.equal(api.resolveImage({ image: "https://example.com/remote.png" }, covers), "https://example.com/remote.png");
  assert.equal(api.resolveImage({ image: cover }, covers), cover, "Legacy inline covers remain usable");
  for (const value of [undefined, null, {}, { image: "" }, { image: 42 }]) {
    assert.equal(api.resolveImage(value, covers), "", `${name}: absent or invalid covers use the page fallback`);
  }
}
assert.deepEqual(item, { title: "Original title", description: "Original summary", image: "local://cover-key" });
assert.deepEqual(covers, { "cover-key": cover, unrelated: "https://example.com/other.png" });
console.log("PASS item edit rules: field normalization, edit flags, local covers, no-op detection and classic compatibility");
