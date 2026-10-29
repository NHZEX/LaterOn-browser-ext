const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calculateStorageUsage, formatStorageBytes } = require("./helpers/load-module.cjs")("wxt/entrypoints/settings/shared.ts");

test("empty storage and binary units", () => {
  assert.deepEqual(calculateStorageUsage({}, 0), {
    totalBytes: 0, itemCount: 0, projectCount: 0, inlineIconCount: 0, remoteIconCount: 0,
    inlineCoverCount: 0, metadataBytes: 0, iconBytes: 0, coverBytes: 0, otherBytes: 0
  });
  assert.equal(formatStorageBytes(0, "en"), "0 B");
  assert.equal(formatStorageBytes(1023, "en"), "1,023 B");
  assert.equal(formatStorageBytes(1024, "en"), "1 KiB");
  assert.equal(formatStorageBytes(1536, "zh-CN"), "1.5 KiB");
  assert.equal(formatStorageBytes(1.25 * 1024 ** 2, "en"), "1.25 MiB");
  assert.equal(formatStorageBytes(1024 ** 3, "en"), "1 GiB");
});

test("counts stored image occurrences, includes encoded overhead and keeps remote URLs in metadata", () => {
  const icon = "data:image/png;base64,AAAA";
  const svg = 'data:image/svg+xml,<svg aria-label="图"/>过';
  const snapshot = {
    laterOnItems: [
      { id: "a", title: "中文网页 🔖", favicon: icon, image: "local://a" },
      { id: "b", favicon: "https://example.test/favicon.ico", image: svg },
      { id: "c", favicon: icon, image: "https://example.test/large-cover.png" }, null
    ],
    laterOnProjects: [{ id: "p", cover: icon, coverPick: ["a", "b"] }],
    laterOnCovers: { a: icon, orphan: icon },
    laterOnSettings: { language: "zh-CN" }, laterOnReadingPositions: { a: 150 }, unknownKey: "保留"
  };
  const before = structuredClone(snapshot);
  const usage = calculateStorageUsage(snapshot, 987654);
  assert.equal(usage.totalBytes, 987654, "Uses the browser-reported total, not a JSON estimate");
  assert.equal(usage.itemCount, 3);
  assert.equal(usage.projectCount, 1);
  assert.equal(usage.inlineIconCount, 2, "Repeated content is counted at each stored occurrence");
  assert.equal(usage.remoteIconCount, 1);
  assert.equal(usage.inlineCoverCount, 4, "Includes legacy inline covers, project covers and unreferenced stored covers");
  assert.equal(usage.iconBytes, 2 * Buffer.byteLength(icon));
  assert.equal(usage.coverBytes, 3 * Buffer.byteLength(icon) + Buffer.byteLength(svg) + 2,
    "SVG quotation marks occupy escaped bytes in stored JSON; Base64 remains encoded");
  const expectedOthers = ["laterOnSettings", "laterOnReadingPositions", "unknownKey"]
    .reduce((sum, key) => sum + Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(snapshot[key])), 0);
  assert.equal(usage.otherBytes, expectedOthers);
  const expectedTotal = Object.entries(snapshot).reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)), 0);
  assert.equal(usage.metadataBytes + usage.iconBytes + usage.coverBytes + usage.otherBytes, expectedTotal);
  assert.deepEqual(snapshot, before, "Statistics never rewrite or normalize stored content");
});

test("legacy partial records and absent collections do not break usage", () => {
  const usage = calculateStorageUsage({ laterOnItems: [null, "bad", { id: "old" }], laterOnCovers: null, preference: true }, 90);
  assert.equal(usage.itemCount, 1);
  assert.equal(usage.projectCount, 0);
  assert.equal(usage.iconBytes, 0);
  assert.equal(usage.coverBytes, 0);
  assert.equal(usage.otherBytes, 14);
});
