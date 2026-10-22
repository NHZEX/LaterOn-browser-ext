// Exercise the artifact and deployment boundary using ignored .output files.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { unzipSync, zipSync, Zip, ZipDeflate } = require("fflate");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".output");
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, "release-tools-"));
const destination = path.join(temporary, "LaterOn");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const archive = path.join(output, `LaterOn-${manifest.version}.zip`);
const builtDirectory = path.join(root, ".output/chrome-mv3");

function command(executable, args, env = {}) {
  const result = spawnSync(executable, args, {
    cwd: root, env: { ...process.env, LATERON_PUBLISH: undefined, LATERON_RELEASE_DIR: undefined, ...env },
    encoding: "utf8", timeout: 60_000, windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${executable}: ${result.stdout}\n${result.stderr}`);
  return result;
}

const wxtCli = path.resolve(path.dirname(require.resolve("wxt")), "../bin/wxt.mjs");
const wxt = (args, env = {}) => command(process.execPath, [wxtCli, ...args], { LATERON_PUBLISH: "false", ...env });
const check = () => command(process.execPath, ["scripts/check-release.mjs"]);

async function verifyModePublishing(hook) {
  const mode = path.basename(temporary);
  const base = path.join(temporary, "模式基础目录");
  const local = path.join(temporary, "模式 本机目录");
  const override = path.join(temporary, "系统 覆盖目录");
  const modeOutput = path.join(output, `chrome-mv3-${mode}`);
  const modeArchive = path.join(output, `LaterOn-${manifest.version}-${mode}.zip`);
  const created = [];
  const previousEnvironment = { LATERON_PUBLISH: process.env.LATERON_PUBLISH, LATERON_RELEASE_DIR: process.env.LATERON_RELEASE_DIR };
  const configure = (suffix, target) => {
    const file = path.join(root, `.env.${mode}${suffix}`);
    const relative = path.relative(root, target).replaceAll("\\", "/");
    fs.writeFileSync(file, `LATERON_PUBLISH=true\nLATERON_RELEASE_DIR="${relative}"\n`, { flag: "wx" });
    created.push(file);
  };
  try {
    configure("", base);
    configure(".local", local);
    const fromFiles = { LATERON_PUBLISH: undefined };
    wxt(["build", "--mode", mode], fromFiles);
    assert.equal(fs.existsSync(local), false, "Build never deploys, even with publishing enabled");
    assert.equal(fs.existsSync(modeArchive), false);
    const result = wxt(["zip", "--mode", mode], fromFiles);
    assert.match(result.stdout, /Published:/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(local, "manifest.json"), "utf8")).version, manifest.version);
    assert.equal(fs.existsSync(base), false, "Mode-local configuration overrides the mode configuration");
    assert.ok(fs.existsSync(modeArchive), "Mode archives have a separate filename");
    assert.ok(fs.existsSync(archive), "The production archive remains available");
    await verifyBuiltWorker(modeOutput);

    // These branches consume the loaded environment; they do not need another compilation.
    process.env.LATERON_PUBLISH = "false";
    process.env.LATERON_RELEASE_DIR = override;
    hook({ config: { root } }, modeArchive);
    assert.equal(fs.existsSync(override), false, "The environment can disable publishing");
    process.env.LATERON_PUBLISH = "true";
    process.env.LATERON_RELEASE_DIR = "   ";
    assert.throws(() => hook({ config: { root } }, modeArchive), /LATERON_RELEASE_DIR is required/);
    process.env.LATERON_RELEASE_DIR = override;
    hook({ config: { root } }, modeArchive);
    assert.ok(fs.existsSync(path.join(override, "manifest.json")), "The hook uses the explicit environment directory");
  } finally {
    Object.entries(previousEnvironment).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    created.forEach((file) => fs.unlinkSync(file));
    assert.equal(path.dirname(modeOutput), output);
    assert.equal(path.basename(modeOutput), `chrome-mv3-${path.basename(temporary)}`);
    fs.rmSync(modeOutput, { recursive: true, force: true });
    fs.rmSync(modeArchive, { force: true });
  }
}

async function verifyBuiltWorker(directory = builtDirectory) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const event = () => ({ addListener() {} });
  const saved = { id: "existing", url: "https://example.com/existing", title: "Existing collection", status: "unread", savedAt: Date.now() };
  const store = { laterOnItems: [saved], laterOnProjects: [], laterOnSettings: {}, laterOnCleanupV165: true };
  const chrome = {
    storage: { local: {
      async get(keys) { return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in store).map((key) => [key, store[key]]))); },
      async set(patch) { Object.assign(store, clone(patch)); },
      async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]); }
    }, onChanged: event() },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (name) => `chrome-extension://fixture/${name}` },
    alarms: { create() {}, onAlarm: event() }, commands: { onCommand: event() },
    contextMenus: { removeAll(callback) { callback?.(); }, create() {}, onClicked: event() },
    tabs: { onUpdated: event(), onRemoved: event(), onCreated: event(), onActivated: event() },
    action: {}, sidePanel: { setPanelBehavior() {} }
  };
  const context = vm.createContext({ chrome, URL, TextEncoder, crypto: webcrypto, console, setTimeout, clearTimeout, setInterval, clearInterval });
  context.importScripts = (...names) => names.forEach((name) => vm.runInContext(fs.readFileSync(path.join(directory, name), "utf8"), context, { filename: name }));
  context.importScripts("background.js");
  assert.equal(typeof context.LaterOnUrl.normalize, "function");
  const pickerPayload = context.LaterOnPicker.buildPayload({ laterOnItems: [saved] }, { batchId: "compiled-batch", tabs: [saved], savedCount: 1 });
  assert.equal(pickerPayload.folders[0].count, 1, "Built worker loads the compiled picker synchronously");
  assert.equal(pickerPayload.batchId, "compiled-batch");
  assert.equal(pickerPayload.savedCount, 1);
  assert.equal(pickerPayload.pages[0].url, saved.url);
  const original = "https://example.com/a%2Fb?q=C++&b=2#/article/1";
  const suspended = `chrome-extension://fixture/suspended.html#ttl=Example&pos=0&uri=${original}`;
  assert.equal(context.LaterOnUrl.suspendedPage(suspended).url, original, "Compiled helper preserves the raw suspended URL");
  assert.equal(context.LaterOnUrl.normalize(suspended), context.LaterOnUrl.normalize(original));
  assert.notEqual(context.LaterOnUrl.normalize(original), context.LaterOnUrl.normalize(original.replace("/1", "/2")), "Compiled helper keeps hash routes distinct");
  assert.equal(typeof context.LaterOnBackup.parse, "function");
  const backup = context.LaterOnBackup.create(store, "1.69.3", "2026-10-23T00:00:00Z");
  assert.equal(backup.format, "lateron.collection");
  assert.equal(context.LaterOnBackup.parse(backup).items[0].url, saved.url, "Built worker exports and validates the same collection");
  assert.throws(() => context.LaterOnBackup.parse({ ...backup, version: 99 }), /UNSUPPORTED_BACKUP/);
  const result = await context.LaterOnCollection.execute({ action: "mutateItems", operation: "update", ids: [saved.id], patch: { status: "reading" } });
  assert.equal(result.ok, true);
  assert.equal(store.laterOnItems[0].status, "reading", "Built classic worker retains existing storage and collection operations");
}

function verifyArchiveChecks(readReleaseArchive) {
  const fixture = path.join(temporary, "validation.zip");
  const write = (files) => fs.writeFileSync(fixture, zipSync(files));
  const files = unzipSync(fs.readFileSync(archive));
  const builtManifest = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8"));
  // A package can contain compiler changes without matching source or build snapshots.
  const compiledManifest = { ...builtManifest, permissions: [...builtManifest.permissions, "bookmarks"],
    action: { ...builtManifest.action, default_icon: "icon16.png" },
    web_accessible_resources: [...(builtManifest.web_accessible_resources ?? []),
      { resources: ["chunks/*.js"], matches: ["https://example.com/*"] }] };
  write({ ...files,
    "url-utils.js": Buffer.concat([files["url-utils.js"], Buffer.from("\n// compiler transformation\n")]),
    "manifest.json": Buffer.from(JSON.stringify(compiledManifest)),
    "chunks/compiled.js": Buffer.from("console.log('compiled chunk');")
  });
  assert.equal(readReleaseArchive(fixture).manifest.version, manifest.version);

  ["tests/leaked.js", ".env", ".env.local"].forEach((name) => {
    write({ ...files, [name]: Buffer.from("unwanted") });
    assert.throws(() => readReleaseArchive(fixture), /Development-only or invalid release file/);
  });
  const { [builtManifest.background.service_worker]: omitted, ...missing } = files;
  write(missing);
  assert.throws(() => readReleaseArchive(fixture), /Manifest references missing package files/);
  write({ ...files, "manifest.json": Buffer.from(JSON.stringify({ ...builtManifest, manifest_version: 2 })) });
  assert.throws(() => readReleaseArchive(fixture), /Expected a named, versioned MV3 package/);

  const chunks = [];
  const duplicate = new Zip((error, data) => { assert.ifError(error); chunks.push(data); });
  [files["url-utils.js"], files["url-utils.js"]].forEach((data) => {
    const entry = new ZipDeflate("url-utils.js");
    duplicate.add(entry);
    entry.push(data, true);
  });
  duplicate.end();
  fs.writeFileSync(fixture, Buffer.concat(chunks));
  assert.throws(() => readReleaseArchive(fixture), /Release ZIP contains duplicate entries/);
  fs.writeFileSync(fixture, "not a ZIP");
  assert.throws(() => readReleaseArchive(fixture));
}

async function main() {
  try {
    const { publishLocal } = await import("../scripts/publish-local.mjs");
    const { readReleaseArchive } = await import("../scripts/check-release.mjs");
    const { default: config } = await import("../wxt.config.mjs");
    const publish = (target) => publishLocal({ archive, destination: target });
    wxt(["zip"]);
    await verifyBuiltWorker();
    verifyArchiveChecks(readReleaseArchive);
    check();
    await verifyModePublishing(config.hooks["zip:extension:done"]);

    publish(destination);
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"), "utf8")).version, manifest.version);
    const installedUrl = path.join(destination, "url-utils.js");
    fs.appendFileSync(installedUrl, "\n// previous local installation\n");
    const oldContents = fs.readFileSync(installedUrl);
    publish(destination);
    assert.deepEqual(fs.readFileSync(installedUrl), fs.readFileSync(path.join(builtDirectory, "url-utils.js")));
    const backups = path.join(temporary, "LaterOn-backups");
    const entries = fs.readdirSync(backups);
    assert.equal(entries.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(backups, entries[0], "url-utils.js")), oldContents, "Backup preserves the prior installation");
    publish(destination);
    assert.deepEqual(fs.readdirSync(backups), entries, "Identical releases do not create redundant backups");

    const unrelated = path.join(temporary, "unrelated");
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, "keep.txt"), "unrelated data");
    assert.throws(() => publish(unrelated), /ENOENT/);
    assert.equal(fs.readFileSync(path.join(unrelated, "keep.txt"), "utf8"), "unrelated data");
    assert.throws(() => publish(root), /project directory or its ancestors/);
    assert.throws(() => publish(path.dirname(root)), /project directory or its ancestors/);
    assert.throws(() => publish(path.parse(root).root), /must name an extension directory/);
    const linked = path.join(temporary, "linked");
    fs.symlinkSync(destination, linked, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => publish(linked), /normal directory/);
    fs.unlinkSync(linked);

    const malicious = path.join(temporary, "malicious.zip");
    fs.writeFileSync(malicious, zipSync({ "../escape.txt": Buffer.from("outside") }));
    assert.throws(() => publishLocal({ archive: malicious, destination }), /invalid release file/);
    assert.equal(fs.existsSync(path.join(temporary, "escape.txt")), false);

    fs.appendFileSync(installedUrl, "\n// previous version for rollback\n");
    const beforeFailure = fs.readFileSync(installedUrl);
    const rename = fs.renameSync;
    try {
      fs.renameSync = (source, target) => {
        if (source.includes("-stage-") && target === destination) throw new Error("simulated install failure");
        return rename(source, target);
      };
      assert.throws(() => publishLocal({ archive, destination }), /simulated install failure/);
    } finally { fs.renameSync = rename; }
    assert.deepEqual(fs.readFileSync(installedUrl), beforeFailure, "A failed installation restores the complete previous directory");
    assert.deepEqual(fs.readdirSync(backups), entries, "Rolled back deployment does not leave a duplicate backup");
    assert.equal(fs.readdirSync(temporary).some((name) => name.includes("-stage-")), false);

    try {
      fs.renameSync = (source, target) => {
        if (target === destination) throw new Error("simulated install and rollback failure");
        return rename(source, target);
      };
      assert.throws(() => publishLocal({ archive, destination }), (error) => error.rollbackFailed === true);
    } finally { fs.renameSync = rename; }
    const recoveryBackup = fs.readdirSync(backups).find((name) => !entries.includes(name));
    const recoveryStage = fs.readdirSync(temporary).find((name) => name.startsWith(".LaterOn-stage-"));
    assert.ok(recoveryBackup && recoveryStage, "A failed rollback preserves both recovery directories");
    assert.deepEqual(fs.readFileSync(path.join(backups, recoveryBackup, "url-utils.js")), beforeFailure);
    assert.deepEqual(fs.readFileSync(path.join(temporary, recoveryStage, "url-utils.js")), fs.readFileSync(path.join(builtDirectory, "url-utils.js")));

    console.log("PASS WXT mode-based publishing hook, built worker, final ZIP checks, backup, rollback and directory protection");
  } finally {
    assert.equal(path.dirname(temporary), output);
    assert.ok(path.basename(temporary).startsWith("release-tools-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
