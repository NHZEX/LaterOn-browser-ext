// Exercise the artifact and deployment boundary using only disposable dist files.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const temporary = fs.mkdtempSync(path.join(dist, "release-tools-"));
const output = path.join(temporary, "archives");
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

const release = (args, expected) => command(process.execPath, ["scripts/release.cjs", ...args], expected);
const publish = (target, expected) => command("pwsh", [
  "-NoProfile", "-File", "scripts/publish-local.ps1", "-Archive", archive, "-Destination", target
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

function verifyBuildGuards() {
  const statePath = path.join(root, ".wxt/compat-build.json");
  const originalState = fs.readFileSync(statePath);
  const state = JSON.parse(originalState);
  try {
    fs.writeFileSync(statePath, JSON.stringify({ ...state, inputs: { ...state.inputs, "wxt/entrypoints/background.js": "stale" } }));
    assert.match(release(["check", "--output-dir", output], 1).stderr, /WXT build is stale/);
  } finally { fs.writeFileSync(statePath, originalState); }

  const runtime = path.join(builtDirectory, "url-utils.js");
  const originalRuntime = fs.readFileSync(runtime);
  try {
    fs.appendFileSync(runtime, "\n// altered output\n");
    assert.match(release(["check", "--output-dir", output], 1).stderr, /WXT build output was modified/);
    const digest = createHash("sha256").update(fs.readFileSync(runtime)).digest("hex");
    fs.writeFileSync(statePath, JSON.stringify({ ...state, outputs: { ...state.outputs, "url-utils.js": digest } }));
    assert.match(release(["check", "--output-dir", output], 1).stderr, /WXT changed legacy runtime files: url-utils.js/);
  } finally {
    fs.writeFileSync(runtime, originalRuntime);
    fs.writeFileSync(statePath, originalState);
  }

  const unexpected = path.join(builtDirectory, "unexpected.js");
  try {
    fs.writeFileSync(unexpected, "unexpected runtime file");
    assert.match(release(["check", "--output-dir", output], 1).stderr, /WXT output differs from allowlist/);
  } finally { fs.unlinkSync(unexpected); }
}

async function main() {
  try {
    release(["build", "--output-dir", output]);
    const firstBuild = fs.readFileSync(archive);
    release(["build", "--output-dir", output]);
    assert.deepEqual(fs.readFileSync(archive), firstBuild, "Identical runtime sources produce an identical ZIP");
    fs.writeFileSync(archive, "outdated archive");
    release(["build", "--output-dir", output]);
    assert.deepEqual(fs.readFileSync(archive), firstBuild, "Rebuilding replaces an outdated ZIP");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(builtDirectory, "manifest.json"), "utf8")), manifest);
    assert.deepEqual(fs.readFileSync(path.join(builtDirectory, "background-runtime.js")), fs.readFileSync(path.join(root, "background.js")));
    await verifyBuiltWorker();
    verifyBuildGuards();
    release(["check", "--output-dir", output]);
    release(["publish"], 1);

    publish(destination);
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"), "utf8")).version, manifest.version);
    const installedUrl = path.join(destination, "url-utils.js");
    fs.appendFileSync(installedUrl, "\n// previous local installation\n");
    const oldContents = fs.readFileSync(installedUrl);
    publish(destination);
    assert.deepEqual(fs.readFileSync(installedUrl), fs.readFileSync(path.join(root, "url-utils.js")));
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

    const python = process.platform === "win32" ? "py" : "python3";
    command(python, [...(process.platform === "win32" ? ["-3.12"] : []), "-B", "-c", [
      "import pathlib, sys, zipfile",
      "archive = pathlib.Path(sys.argv[1])",
      "with zipfile.ZipFile(archive) as package: entries = [(i, package.read(i)) for i in package.infolist()]",
      "with zipfile.ZipFile(archive, 'w') as package:",
      "    for info, data in entries: package.writestr(info, data + b'\\n// stale' if info.filename == 'url-utils.js' else data)"
    ].join("\n"), archive]);
    const stale = release(["check", "--output-dir", output], 1);
    assert.match(stale.stderr, /differs from current source: url-utils\.js/);
    console.log("PASS WXT classic worker, manifest and storage compatibility, build guards, reproducible packaging and local deployment");
  } finally {
    assert.equal(path.dirname(temporary), dist);
    assert.ok(path.basename(temporary).startsWith("release-tools-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
