const assert = require("node:assert/strict");
const vm = require("node:vm");
const direct = require("../src/collection/filter.ts");
const classic = vm.createContext({});
vm.runInContext(require("./helpers/read-runtime.cjs")("collection-filter.js"), classic);

for (const rules of [direct, classic.LaterOnFilter]) {
  for (const value of [undefined, null, "", "unknown", {}, 0]) {
    assert.equal(rules.normalizeFilter(value), "unread");
    assert.equal(rules.normalizeSort(value), "newest");
  }
  for (const value of ["all", "unread", "done"]) assert.equal(rules.normalizeFilter(value), value);
  for (const value of ["newest", "oldest", "source", "custom"]) assert.equal(rules.normalizeSort(value), value);
  for (const status of ["unread", "reading", "done"]) {
    const item = Object.freeze({ status });
    assert.equal(rules.matchesReadFilter(item, "all"), true);
    assert.equal(rules.matchesReadFilter(item, "unread"), status !== "done");
    assert.equal(rules.matchesReadFilter(item, "done"), status === "done");
  }
  for (const field of ["title", "description", "source", "url"]) {
    const item = Object.freeze({ [field]: "Alpha/BETA" });
    assert.equal(rules.matchesSearch(item, rules.normalizeSearch("  BeTA  ")), true);
    assert.equal(rules.matchesSearch(item, "missing"), false);
    assert.equal(rules.matchesSearch(item, ""), true);
  }
  assert.equal(rules.matchesSearch({}, "undefined"), false);
  assert.equal(rules.matchesSearch({ title: null }, "null"), false);
}
console.log("PASS shared reading filters, search fields, normalization and compatibility entry");
