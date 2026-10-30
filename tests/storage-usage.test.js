const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calculateStorageUsage, createStorageIconIndex, storageIconPage, formatStorageBytes } = require("./helpers/load-module.cjs")("wxt/entrypoints/settings/shared.ts");

test("empty storage and binary units", () => {
  assert.deepEqual(calculateStorageUsage({}, 0), {
    totalBytes: 0, itemCount: 0, projectCount: 0, inlineIconCount: 0, storedIconCount: 0, remoteIconCount: 0,
    inlineCoverCount: 0, metadataBytes: 0, iconBytes: 0, coverBytes: 0, otherBytes: 0, missingIconCount: 0
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

test("shared icons count stored images once, while references and pool keys stay in metadata", () => {
  const hash = "a".repeat(64), icon = "data:image/png;base64,AAAA";
  const snapshot = { laterOnItems: [{ id: "one", favicon: `icon://${hash}` }, { id: "two", favicon: `icon://${hash}` },
    { id: "legacy", favicon: icon }, { id: "missing", favicon: `icon://${"b".repeat(64)}` }],
    laterOnIcons: { [hash]: icon }, laterOnProjects: [] };
  const before = structuredClone(snapshot);
  const usage = calculateStorageUsage(snapshot, 9000);
  assert.equal(usage.inlineIconCount, 3);
  assert.equal(usage.storedIconCount, 2, "One shared image plus one remaining inline occurrence");
  assert.equal(usage.iconBytes, 2 * Buffer.byteLength(icon));
  assert.equal(usage.otherBytes, 0);
  const bytes = Object.entries(snapshot).reduce((n, [key, value]) => n + Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)), 0);
  assert.equal(usage.metadataBytes + usage.iconBytes, bytes);
  assert.deepEqual(snapshot, before);
});

test("icon details count each pool entry, its actual users and standalone images without fetching or rewriting", () => {
  const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
  const image = 'data:image/svg+xml,<svg aria-label="图"/>';
  const snapshot = {
    laterOnItems: [
      { url: "https://one.test/first", favicon: `icon://${a}` },
      { url: "https://one.test/second", favicon: `icon://${a}` },
      { url: "https://two.test/", favicon: `icon://${a}` },
      { url: "bad URL", favicon: image },
      { favicon: `icon://${c}` }, { favicon: "icon://broken" },
      { favicon: "https://remote.test/favicon.ico" }, null
    ],
    laterOnIcons: { [a]: image, [b]: image, [c]: null }
  };
  const original = structuredClone(snapshot);
  const usage = calculateStorageUsage(snapshot, 15000);
  const details = storageIconPage(createStorageIconIndex(snapshot), 0);
  assert.equal(usage.inlineIconCount, 4);
  assert.equal(usage.storedIconCount, 3);
  assert.equal(usage.missingIconCount, 2);
  assert.equal(usage.remoteIconCount, 1);
  assert.equal(details.length, 3);
  assert.deepEqual(details[0], { key: `pool:${a}`, source: image, sites: ["one.test", "two.test"],
    references: 3, shared: true, bytes: Buffer.byteLength(JSON.stringify(image)) - 2 });
  assert.deepEqual(details.find(row => row.key === `pool:${b}`).sites, []);
  assert.equal(details.find(row => row.key === `pool:${b}`).references, 0, "An unreferenced stored image remains visible");
  assert.deepEqual(details.find(row => !row.shared), { key: "inline:3", source: image, sites: [], references: 1,
    shared: false, bytes: Buffer.byteLength(JSON.stringify(image)) - 2 });
  assert.equal(details.reduce((n, row) => n + row.bytes, 0), usage.iconBytes);
  assert.deepEqual(snapshot, original, "Inspecting does not migrate or garbage collect images");
});

test("large icon lists paginate without retaining collection records or unlimited source examples", () => {
  const image = "data:image/png;base64,AAAA", key = i => i.toString(16).padStart(64, "0");
  const snapshot = {
    laterOnItems: Array.from({ length: 1000 }, (_, i) => ({ favicon: `icon://${key(0)}`, url: `https://site-${i}.test/`, image: "large-cover" })),
    laterOnIcons: Object.fromEntries(Array.from({ length: 55 }, (_, i) => [key(i), image]))
  };
  const index = createStorageIconIndex(snapshot);
  assert.equal(index.length, 55);
  assert.equal(index[0].references, 1000);
  assert.equal(index[0].urls.length, 3, "Reference counts stay exact while source samples are bounded");
  const pages = [0, 1, 2].map(page => storageIconPage(index, page));
  assert.deepEqual(pages.map(rows => rows.length), [20, 20, 15]);
  assert.equal(new Set(pages.flat().map(row => row.key)).size, 55);
  assert.deepEqual(storageIconPage(index, -1), pages[0]);
  assert.deepEqual(storageIconPage(index, 99), pages[2]);
  assert.deepEqual(storageIconPage([], 0), []);
  assert.deepEqual(pages[0][0].sites, ["site-0.test", "site-1.test", "site-2.test"]);
});
