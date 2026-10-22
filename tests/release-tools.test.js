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

function command(executable, args, expected = 0) {
  const result = spawnSync(executable, args, {
    cwd: root, encoding: "utf8", timeout: 60_000, windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${executable}: ${result.stdout}\n${result.stderr}`);
  return result;
}

const wxtCli = path.resolve(path.dirname(require.resolve("wxt")), "../bin/wxt.mjs");
const wxt = (args) => command(process.execPath, [wxtCli, ...args]);
const check = (expected) => command(process.execPath, ["scripts/check-release.mjs"], expected);
const publish = (target, expected, source = archive) => command(process.execPath, [
  "scripts/publish-local.mjs", "--archive", source, "--dir", target
], expected);

async function verifyBuiltWorker() {
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
  context.importScripts = (...names) => names.forEach((name) => vm.runInContext(fs.readFileSync(path.join(builtDirectory, name), "utf8"), context, { filename: name }));
  context.importScripts("background.js");
  assert.equal(typeof context.LaterOnUrl.normalize, "function");
  assert.equal(typeof context.LaterOnBackup.parse, "function");
  const result = await context.LaterOnCollection.execute({ action: "mutateItems", operation: "update", ids: [saved.id], patch: { status: "reading" } });
  assert.equal(result.ok, true);
  assert.equal(store.laterOnItems[0].status, "reading", "Built classic worker retains existing storage and collection operations");
}

function verifyArchiveChecks() {
  const original = fs.readFileSync(archive);
  const files = unzipSync(original);
  const builtManifest = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8"));
  try {
    // A package can contain compiler changes without matching source or build snapshots.
    const compiledManifest = { ...builtManifest, permissions: [...builtManifest.permissions, "bookmarks"],
      action: { ...builtManifest.action, default_icon: "icon16.png" },
      web_accessible_resources: [...(builtManifest.web_accessible_resources ?? []),
        { resources: ["chunks/*.js"], matches: ["https://example.com/*"] }] };
    fs.writeFileSync(archive, zipSync({ ...files,
      "url-utils.js": Buffer.concat([files["url-utils.js"], Buffer.from("\n// compiler transformation\n")]),
      "manifest.json": Buffer.from(JSON.stringify(compiledManifest)),
      "chunks/compiled.js": Buffer.from("console.log('compiled chunk');")
    }));
    check();

    fs.writeFileSync(archive, zipSync({ ...files, "tests/leaked.js": Buffer.from("unwanted") }));
    assert.match(check(1).stderr, /Development-only or invalid release file/);
    const { [builtManifest.background.service_worker]: omitted, ...missing } = files;
    fs.writeFileSync(archive, zipSync(missing));
    assert.match(check(1).stderr, /Manifest references missing package files/);
    fs.writeFileSync(archive, zipSync({ ...files, "manifest.json": Buffer.from(JSON.stringify({ ...builtManifest, manifest_version: 2 })) }));
    assert.match(check(1).stderr, /Expected a named, versioned MV3 package/);

    const chunks = [];
    const duplicate = new Zip((error, data) => { assert.ifError(error); chunks.push(data); });
    [files["url-utils.js"], files["url-utils.js"]].forEach((data) => {
      const entry = new ZipDeflate("url-utils.js");
      duplicate.add(entry);
      entry.push(data, true);
    });
    duplicate.end();
    fs.writeFileSync(archive, Buffer.concat(chunks));
    assert.match(check(1).stderr, /Release ZIP contains duplicate entries/);
    fs.writeFileSync(archive, "not a ZIP");
    check(1);
  } finally { fs.writeFileSync(archive, original); }
}

async function main() {
  try {
    wxt(["zip"]);
    await verifyBuiltWorker();
    verifyArchiveChecks();
    check();

    command(process.execPath, ["scripts/publish-local.mjs", "--dir", destination]);
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
    assert.match(publish(destination).stdout, /Already installed/);
    assert.deepEqual(fs.readdirSync(backups), entries, "Identical releases do not create redundant backups");

    const unrelated = path.join(temporary, "unrelated");
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, "keep.txt"), "unrelated data");
    publish(unrelated, 1);
    assert.equal(fs.readFileSync(path.join(unrelated, "keep.txt"), "utf8"), "unrelated data");
    publish(root, 1);
    publish(path.dirname(root), 1);
    publish(path.parse(root).root, 1);
    const linked = path.join(temporary, "linked");
    fs.symlinkSync(destination, linked, process.platform === "win32" ? "junction" : "dir");
    assert.match(publish(linked, 1).stderr, /normal directory/);
    fs.unlinkSync(linked);

    const malicious = path.join(temporary, "malicious.zip");
    fs.writeFileSync(malicious, zipSync({ "../escape.txt": Buffer.from("outside") }));
    assert.match(publish(destination, 1, malicious).stderr, /invalid release file/);
    assert.equal(fs.existsSync(path.join(temporary, "escape.txt")), false);

    const { publishLocal } = await import("../scripts/publish-local.mjs");
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

    console.log("PASS built worker, final ZIP checks, Node deployment, backup, rollback and directory protection");
  } finally {
    assert.equal(path.dirname(temporary), output);
    assert.ok(path.basename(temporary).startsWith("release-tools-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
