const assert = require("node:assert/strict");
const vm = require("node:vm");
const { createWorkerContext } = require("./helpers/worker-context.cjs");
const { randomBytes, webcrypto } = require("node:crypto");
const { zipSync } = require("fflate");
const readRuntime = require("./helpers/read-runtime.cjs");
const { BACKUP_ALARM, BACKUP_STATE, backupFileName } = require("./helpers/load-module.cjs")("src/backup/webdav-shared.ts");
const legacyPending = "laterOnWebdavBackupPending";

const root = "/dav/Fixture/backups/";
const files = new Map();
const folders = new Set(["/dav/"]);
let lostPublishResponse = false;
let interruptBeforePublish = false;
let denyAutoCleanup = false;
let propfindXml = null;
let requests = 0;
const methods = [];
function davResponse(path) {
  return `<d:response><d:href>${path}</d:href><d:propstat><d:prop><d:resourcetype>${folders.has(path) ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>${Buffer.byteLength(files.get(path) ?? "")}</d:getcontentlength></d:prop></d:propstat></d:response>`;
}
async function fetchFixture(url, request) {
  requests += 1;
  methods.push(request.method === "PROPFIND" ? `PROPFIND ${request.headers.Depth}` : request.method);
  assert.equal(new URL(url).origin, "https://dav.example.test");
  const path = new URL(url).pathname;
  assert.equal(request.headers.Authorization, "Basic " + btoa("fixture:fixture"));
  if (request.method === "MKCOL") {
    if (folders.has(path)) return new Response(null, { status: 405 });
    folders.add(path);
    return new Response(null, { status: 201 });
  }
  if (request.method === "PROPFIND") {
    if (!folders.has(path)) return new Response(null, { status: 404 });
    if (propfindXml !== null) {
      const xml = propfindXml;
      propfindXml = null;
      return new Response(xml, { status: 207 });
    }
    const directChildren = request.headers.Depth === "1" ? [...folders, ...files.keys()].filter(candidate =>
      candidate !== path && candidate.startsWith(path) && !candidate.slice(path.length).replace(/\/$/, "").includes("/")) : [];
    return new Response(`<d:multistatus xmlns:d="DAV:">${[path, ...directChildren].map(davResponse).join("")}</d:multistatus>`, { status: 207 });
  }
  if (request.method === "GET") return files.has(path) ? new Response(files.get(path)) : new Response(null, { status: 404 });
  if (request.method === "PUT") {
    assert.equal(request.headers["Content-Type"], "application/zip");
    files.set(path, Buffer.from(request.body));
    return new Response(null, { status: 201 });
  }
  if (request.method === "MOVE") {
    assert.equal(request.headers.Overwrite, "F");
    if (!files.has(path)) return new Response(null, { status: 404 });
    const destination = new URL(request.headers.Destination).pathname;
    if (files.has(destination)) return new Response(null, { status: 412 });
    if (interruptBeforePublish) {
      interruptBeforePublish = false;
      throw new TypeError("fixture disconnect before publication");
    }
    files.set(destination, files.get(path));
    files.delete(path);
    if (lostPublishResponse) {
      lostPublishResponse = false;
      throw new TypeError("fixture disconnect");
    }
    return new Response(null, { status: 201 });
  }
  if (request.method === "DELETE") {
    if (denyAutoCleanup && path.endsWith("-auto.zip")) return new Response(null, { status: 403 });
    return new Response(null, { status: files.delete(path) ? 204 : 404 });
  }
  throw new Error(`Unexpected request: ${request.method}`);
}

function profile(item) {
  let time = Date.parse("2026-11-19T08:30:00.123Z");
  let listeners = [];
  let alarms = [];
  const emptyEvent = () => ({ addListener() {} });
  const storage = { laterOnItems: [item], laterOnProjects: [], laterOnCleanupV165: true, laterOnSettings: { autoCleanEnabled: false } };
  const local = {
    async get(keys) {
      return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in storage).map(key => [key, storage[key]])));
    },
    async set(values) { Object.assign(storage, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; }
  };
  function restart() {
    listeners = [];
    alarms = [];
    const chrome = {
      storage: { local, onChanged: emptyEvent() },
      alarms: { async create() {}, async clear() {}, onAlarm: { addListener(fn) { alarms.push(fn); } } },
      contextMenus: { removeAll(done) { done?.(); }, create() {}, onClicked: emptyEvent() },
      commands: { onCommand: emptyEvent() },
      runtime: { onStartup: emptyEvent(), onInstalled: emptyEvent(), onMessage: { addListener(fn) { listeners.push(fn); } },
        getManifest: () => ({ version: "1.78.0" }), getURL: name => `chrome-extension://fixture/${name}` },
      tabs: { onUpdated: emptyEvent(), onRemoved: emptyEvent(), onCreated: emptyEvent(), onActivated: emptyEvent() },
      action: {}, sidePanel: { setPanelBehavior() {} }
    };
    const clock = class extends Date {
      constructor(value = time) { super(value); }
      static now() { return time; }
    };
    const ctx = createWorkerContext({ chrome, URL, TextEncoder, TextDecoder, Date: clock, crypto: webcrypto, btoa, atob,
      AbortSignal, fetch: fetchFixture, console, setTimeout, clearTimeout });
    vm.runInContext(readRuntime("background-test-api.js"), ctx);
  }
  restart();
  const send = message => new Promise(resolve => {
    for (const listener of listeners) {
      if (listener(message, { url: "chrome-extension://fixture/settings.html" }, resolve) === true) return;
    }
    throw new Error(`No handler for ${message.type}`);
  });
  const request = (action, fields) => send({ type: "WEBDAV_BACKUP", action, ...fields });
  return {
    storage, request, send, restart, now: () => time,
    step(hours) { time += hours * 3_600_000; },
    async alarm() { for (const listener of alarms) listener({ name: BACKUP_ALARM }); return request("status"); }
  };
}

const item = title => ({ id: title, url: `https://example.test/${title}`, title, savedAt: 1, status: "reading", projectId: null });
const settings = { endpoint: "https://dav.example.test/dav/", directory: "Fixture", username: "fixture", automatic: true,
  intervalHours: 24, includeImages: false, budgetMiB: 128 };
const save = (browser, options = settings) => browser.request("save", { options, password: "fixture" });

(async () => {
  const { TextWriter, Uint8ArrayReader, ZipReader } = await import("@zip.js/zip.js/lib/zip-core-custom.js");
  const first = profile(item("first"));
  const second = profile(item("second"));
  const source = await save(first, { ...settings, automatic: false });
  const target = await save(second);
  assert(source.ok && target.ok);
  const firstPath = root + source.status.device + "/";
  const published = path => [...files.keys()].filter(name => name.startsWith(path) && name.endsWith(".zip"));
  assert.notEqual(source.status.device, target.status.device);
  assert(!("password" in source.status.options));
  assert((await first.request("test")).ok);
  propfindXml = `<multistatus xmlns="DAV:" xmlns:alt="DAV:" xmlns:other="urn:ignored"><response>
    <other:href>/wrong-path/</other:href><alt:href>https://dav.example.test/da&#118;/</alt:href>
    <propstat><prop><resourcetype><alt:collection/></resourcetype></prop></propstat></response></multistatus>`;
  assert((await first.request("test")).ok, "DAV names are resolved by namespace, and XML character references are decoded");
  propfindXml = `<d:multistatus xmlns:d="DAV:"><d:response></d:multistatus>`;
  assert.equal((await first.request("test")).error, "WEBDAV_LIST");
  propfindXml = `<!DOCTYPE d:multistatus><d:multistatus xmlns:d="DAV:">${davResponse("/dav/")}</d:multistatus>`;
  assert.equal((await first.request("test")).error, "WEBDAV_LIST");
  propfindXml = `<d:multistatus xmlns:d="DAV:">${davResponse("/dav/").repeat(750)}</d:multistatus>`;
  assert.equal((await first.request("test")).error, "WEBDAV_LIST_LIMIT");

  lostPublishResponse = true;
  const beforeFirst = methods.length;
  assert.equal((await first.request("backup")).error, "WEBDAV_NETWORK");
  assert.deepEqual(methods.slice(beforeFirst), ["PROPFIND 0", "MKCOL", "MKCOL", "MKCOL", "PUT", "MOVE"]);
  assert(!Object.hasOwn(first.storage, legacyPending));
  assert.equal(published(firstPath).length, 1);
  first.storage[legacyPending] = { body: "obsolete snapshot" };
  first.restart();
  first.storage.laterOnItems[0].title = "Updated without advancing the clock";
  const beforeRetry = methods.length;
  const retried = await first.request("backup");
  assert(retried.name.endsWith("-manual-02.zip"));
  assert.deepEqual(methods.slice(beforeRetry), ["PROPFIND 0", "PUT", "MOVE", "MOVE"]);
  assert.equal((await first.request("restore", { device: source.status.device, name: retried.name })).payload.data.items[0].title,
    "Updated without advancing the clock", "Retry after restart backs up the latest collection");
  assert(!Object.hasOwn(first.storage, legacyPending));
  assert.equal(published(firstPath).length, 2);

  first.step(1);
  const beforeManual = methods.length;
  assert((await first.request("backup", { includeImages: true })).ok);
  assert.deepEqual(methods.slice(beforeManual), ["PROPFIND 0", "PUT", "MOVE"]);
  const legacy = firstPath + "2026-11-18T08-30-00.000Z-auto.json";
  files.set(legacy, "{}");
  const cloud = await second.request("list");
  assert.equal(cloud.entries.length, 3);
  const archivePath = firstPath + cloud.entries[0].name;
  const originalArchive = files.get(archivePath);
  assert.equal(cloud.entries[0].bytes, originalArchive.byteLength);
  const { payload } = await second.request("restore", cloud.entries[0]);
  assert.equal(payload.data.items[0].title, "Updated without advancing the clock");
  const reader = new ZipReader(new Uint8ArrayReader(originalArchive), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    assert.deepEqual(entries.map(entry => [entry.filename, entry.compressionMethod]), [["manifest.json", 0], ["backup.json", 8]]);
    const manifest = JSON.parse(await entries[0].getData(new TextWriter(), { checkCrc32: true }));
    assert.deepEqual(manifest, {
      version: 1, backup: { file: "backup.json", format: payload.format, version: payload.version }, appVersion: payload.appVersion,
      exportedAt: payload.exportedAt, counts: { items: 1, projects: 0, covers: 0, positions: 0 }, includeImages: true
    });
  } finally {
    await reader.close();
  }
  const backupOnly = zipSync({ "backup.json": Buffer.from(JSON.stringify(payload)) });
  files.set(archivePath, zipSync({ "notes.txt": Buffer.from("Extra entry"), "backup.json": Buffer.from(JSON.stringify(payload)) }));
  assert.deepEqual((await second.request("restore", cloud.entries[0])).payload, payload);
  files.set(archivePath, backupOnly);
  assert.deepEqual((await second.request("restore", cloud.entries[0])).payload, payload);
  files.set(archivePath, zipSync({ "notes.txt": Buffer.from("Missing backup.json") }));
  assert.equal((await second.request("restore", cloud.entries[0])).error, "WEBDAV_INVALID_BACKUP");
  const corrupted = Buffer.from(backupOnly);
  const central = corrupted.readUInt32LE(corrupted.length - 6);
  const wrongCrc = (corrupted.readUInt32LE(central + 16) ^ 1) >>> 0;
  corrupted.writeUInt32LE(wrongCrc, 14);
  corrupted.writeUInt32LE(wrongCrc, central + 16);
  files.set(archivePath, corrupted);
  assert.equal((await second.request("restore", cloud.entries[0])).error, "WEBDAV_INVALID_BACKUP");
  const oversized = Buffer.from(backupOnly);
  oversized.writeUInt32LE(50 * 1024 * 1024 + 1, central + 24);
  files.set(archivePath, oversized);
  assert.equal((await second.request("restore", cloud.entries[0])).error, "BACKUP_TOO_LARGE");
  files.set(archivePath, originalArchive);
  const preview = await second.send({ type: "BACKUP_PREVIEW", payload, mode: "replace" });
  assert.equal(second.storage.laterOnItems[0].id, "second", "Preview does not write data");
  const restored = await second.send({ type: "BACKUP_APPLY", payload, mode: "replace", token: preview.token, keepRecovery: true });
  assert(restored.ok);
  assert.equal(second.storage.laterOnItems[0].id, "first");
  assert.equal((await second.send({ type: "BACKUP_RECOVERY" })).payload.data.items[0].id, "second");
  const secondFolder = root + target.status.device + "/";
  second.storage[BACKUP_STATE].after = second.now() + 30 * 60_000;
  const beforeLegacyDelay = requests;
  await second.alarm();
  assert.equal(requests, beforeLegacyDelay, "An existing automatic-check delay remains in effect after upgrade");
  second.step(0.5);
  interruptBeforePublish = true;
  const interrupted = await second.alarm();
  assert.equal(interrupted.status.lastError, "WEBDAV_NETWORK");
  assert.equal(second.storage[BACKUP_STATE].nextAutomaticCheckAt, second.now() + 30 * 60_000);
  assert(!Object.hasOwn(second.storage[BACKUP_STATE], "after"));
  assert.equal(published(secondFolder).length, 0);
  const secondStaging = secondFolder + `.${backupFileName(second.now(), "auto", 1)}.upload`;
  assert(files.has(secondStaging));
  second.step(0.5);
  second.storage.laterOnItems[0].description = "Edited after the failed automatic backup";
  const beforeAutomaticRetry = methods.length;
  assert.equal((await second.alarm()).status.lastError, null);
  assert.deepEqual(methods.slice(beforeAutomaticRetry), ["PROPFIND 1", "PUT", "MOVE"]);
  assert.equal(published(secondFolder).length, 1);
  const autoRetried = await second.request("restore", { device: target.status.device, name: published(secondFolder)[0].slice(secondFolder.length) });
  assert.equal(autoRetried.payload.data.items[0].description, "Edited after the failed automatic backup");

  assert((await save(first, { ...settings, intervalHours: 1 })).ok);
  const beforeAuto = methods.length;
  await first.alarm();
  assert.deepEqual(methods.slice(beforeAuto), ["PROPFIND 1", "PUT", "MOVE"]);
  const stagingAt = (time, kind = "auto", sequence = 1) => firstPath + `.${backupFileName(time, kind, sequence)}.upload`;
  const expiresEarly = stagingAt(first.now() - 49 * 3_600_000);
  const expiresLate = stagingAt(first.now() - 25 * 3_600_000, "manual");
  const freshStaging = stagingAt(first.now() - 24 * 3_600_000);
  const unrecognized = stagingAt(first.now() - 49 * 3_600_000, "auto", 2);
  for (const path of [expiresEarly, expiresLate, freshStaging, unrecognized]) files.set(path, Buffer.from("temporary"));
  const autoFiles = () => published(firstPath).filter(name => name.endsWith("-auto.zip"));
  for (let hour = 1; hour <= 7; hour += 1) {
    first.step(1);
    first.storage.laterOnItems[0].description = `hour ${hour}`;
    const beforeBackup = methods.length;
    const { status } = await first.alarm();
    assert.equal(status.lastError, null);
    assert.deepEqual(methods.slice(beforeBackup), ["PROPFIND 0", "PUT", "MOVE"]);
  }
  assert.equal(autoFiles().length, 8);
  first.restart();
  first.step(16);
  first.storage.laterOnItems[0].description = "23 hours after the previous check";
  const beforeEarlyBackup = methods.length;
  await first.alarm();
  assert.deepEqual(methods.slice(beforeEarlyBackup), ["PROPFIND 0", "PUT", "MOVE"]);
  assert.equal(autoFiles().length, 9, "Restart does not reset the rotation interval");
  assert(files.has(expiresEarly), "A backup before the rotation date skips old staging files");

  first.step(1);
  first.storage.laterOnItems[0].description = "24 hours after the previous check";
  const beforeDueBackup = methods.length;
  const due = await first.alarm();
  assert.equal(due.status.lastError, null);
  assert.equal(due.status.cleanupPending, false);
  assert.deepEqual(methods.slice(beforeDueBackup), ["PROPFIND 1", "PUT", "MOVE", ...Array(5).fill("DELETE")]);
  assert(!files.has(expiresEarly) && !files.has(expiresLate));
  assert(files.has(freshStaging) && files.has(unrecognized) && files.has(secondStaging));
  assert.equal(autoFiles().length, 7);
  assert.equal(published(firstPath).filter(name => /-manual(?:-\d+)?\.zip$/.test(name)).length, 3);
  assert.equal(files.get(legacy), "{}");
  assert.equal(published(secondFolder).length, 1);

  denyAutoCleanup = true;
  first.step(24);
  first.storage.laterOnItems[0].description = "cleanup denied";
  const beforeCleanupFailure = methods.length;
  const denied = await first.alarm();
  assert(denied.status.lastBackup > due.status.lastBackup);
  assert.equal(denied.status.lastError, null);
  assert.equal(denied.status.cleanupPending, true);
  assert.deepEqual(methods.slice(beforeCleanupFailure), ["PROPFIND 1", "PUT", "MOVE", "DELETE"]);
  assert.equal(autoFiles().length, 8);

  denyAutoCleanup = false;
  first.step(1);
  first.storage.laterOnItems[0].description = "backup during cleanup cooldown";
  const beforeCooldown = methods.length;
  assert.equal((await first.alarm()).status.cleanupPending, true);
  assert.deepEqual(methods.slice(beforeCooldown), ["PROPFIND 0", "PUT", "MOVE"]);
  assert.equal(autoFiles().length, 9);

  first.step(23);
  const beforeUnchanged = requests;
  assert.equal((await first.alarm()).status.cleanupPending, true);
  assert.equal(requests, beforeUnchanged, "An overdue cleanup does not make requests without a new backup");
  first.step(0.5);
  first.storage.laterOnItems[0].description = "new backup with cleanup due";
  const beforeRetryCleanup = methods.length;
  const recovered = await first.alarm();
  assert.equal(recovered.status.cleanupPending, false);
  assert.deepEqual(methods.slice(beforeRetryCleanup), ["PROPFIND 1", "PUT", "MOVE", ...Array(4).fill("DELETE")]);
  assert.equal(autoFiles().length, 7);
  assert(!files.has(freshStaging) && files.has(unrecognized) && files.has(secondStaging));

  assert((await save(first, { ...settings, budgetMiB: 1, automatic: false })).ok);
  first.storage.laterOnItems[0].description = randomBytes(1_500_000).toString("base64");
  const beforeLimited = requests;
  assert.equal((await first.request("backup")).error, "WEBDAV_BUDGET");
  assert.equal(requests, beforeLimited);
  const beforeOverride = (await first.request("status")).status.usage;
  const override = await first.request("backup", { allowOverBudget: true });
  assert(override.ok);
  assert(override.status.usage.uploaded - beforeOverride.uploaded > 1_000_000);
  assert(override.status.usage.downloaded - beforeOverride.downloaded < 5_000);
  console.log("PASS WebDAV: upload, retries, collision handling, budget, rotation, and restore across profiles");
})().catch(error => { console.error(error); process.exitCode = 1; });
