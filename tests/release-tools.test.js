// Exercise the artifact and deployment boundary using only disposable dist files.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const temporary = fs.mkdtempSync(path.join(dist, "release-tools-"));
const output = path.join(temporary, "archives");
const destination = path.join(temporary, "LaterOn");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const archive = path.join(output, `LaterOn-${manifest.version}.zip`);

function command(executable, args, expected = 0) {
  const result = spawnSync(executable, args, {
    cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${executable}: ${result.stdout}\n${result.stderr}`);
  return result;
}

const release = (args, expected) => command(process.execPath, ["scripts/release.cjs", ...args], expected);
const publish = (target, expected) => command("pwsh", [
  "-NoProfile", "-File", "scripts/publish-local.ps1", "-Archive", archive, "-Destination", target
], expected);

try {
  release(["build", "--output-dir", output]);
  const firstBuild = fs.readFileSync(archive);
  release(["build", "--output-dir", output]);
  assert.deepEqual(fs.readFileSync(archive), firstBuild, "Identical runtime sources produce an identical ZIP");
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
  console.log("PASS reproducible packaging, stale artifact rejection, local install, backup and destination protection");
} finally {
  assert.equal(path.dirname(temporary), dist);
  assert.ok(path.basename(temporary).startsWith("release-tools-"));
  fs.rmSync(temporary, { recursive: true, force: true });
}
