const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipSync } = require("fflate");

const version = "1.70.4";
const local = { manifest_version: 3, name: "StaySide", version, key: "fixed-public-key" };
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lateron-release-"));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function fixture(name) {
  const root = path.join(temporary, name);
  fs.mkdirSync(path.join(root, ".output"), { recursive: true });
  writeJson(path.join(root, "manifest.json"), local);
  const archive = (manifest, extra = {}) => {
    const file = path.join(root, ".output", `StaySide-${version}.zip`);
    fs.writeFileSync(file, zipSync({ "manifest.json": Buffer.from(JSON.stringify(manifest)), "worker.js": Buffer.from("// worker"), ...extra }));
    return file;
  };
  archive(local);
  return { root, archive };
}

const git = (root, args) => execFileSync("git", [
  "-c", "user.name=Release tests", "-c", "user.email=release@example.invalid",
  "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${path.join(temporary, "no-hooks")}`, ...args
], { cwd: root, encoding: "utf8", windowsHide: true }).trim();

function history(root, { baseline = true, currentTag = true } = {}) {
  git(root, ["init", "--quiet", "--initial-branch=main", "--template="]);
  const commit = subject => {
    fs.writeFileSync(path.join(root, "change.txt"), subject);
    git(root, ["add", "change.txt"]);
    git(root, ["commit", "--quiet", "-m", subject]);
    return git(root, ["rev-parse", "HEAD"]);
  };
  const old = commit("feat: old baseline");
  if (baseline) git(root, ["tag", "-a", "v1.70.3", "-m", "Previous release"]);
  const fix = commit("fix: first change");
  const latest = commit("build: 发布 [安装包]");
  if (currentTag) git(root, ["tag", "-a", `v${version}`, "-m", "Current release"]);
  return { old, fix, latest };
}

async function main() {
  const { prepareRelease } = await import("../scripts/prepare-release.mjs");
  const valid = fixture("valid");
  const commits = history(valid.root);
  const repositoryUrl = "https://github.com/example/lateron";
  // Neither a newer unreachable tag nor a prerelease may replace the reachable version baseline.
  const unrelated = git(valid.root, ["commit-tree", `${commits.latest}^{tree}`, "-m", "Unrelated release"]);
  git(valid.root, ["tag", "v9.0.0", unrelated]);
  git(valid.root, ["tag", "v1.70.4-rc.1", commits.fix]);
  fs.writeFileSync(path.join(valid.root, ".output", `StaySide-${version}-store.zip`), "Unused store archive");
  const result = prepareRelease({ root: valid.root, tag: `v${version}`, repositoryUrl });
  assert.equal(result.version, version);
  assert.deepEqual(fs.readdirSync(result.directory).sort(), [
    `StaySide-${version}.zip`, `StaySide-${version}.zip.sha256`, "RELEASE_NOTES.md"
  ].sort());
  assert.equal(fs.readFileSync(path.join(result.directory, "RELEASE_NOTES.md"), "utf8"),
    `## Changes since v1.70.3\n\n- fix: first change ([${commits.fix.slice(0, 7)}](${repositoryUrl}/commit/${commits.fix}))\n` +
    `- build: 发布 \\[安装包\\] ([${commits.latest.slice(0, 7)}](${repositoryUrl}/commit/${commits.latest}))\n\n` +
    `[Full Changelog](${repositoryUrl}/compare/v1.70.3...v${version})\n`);
  const name = `StaySide-${version}.zip`;
  const original = fs.readFileSync(path.join(valid.root, ".output", name));
  assert.deepEqual(fs.readFileSync(path.join(result.directory, name)), original, "Publish the validated WXT bytes unchanged");
  const expected = `${createHash("sha256").update(original).digest("hex")}  ${name}\n`;
  assert.equal(fs.readFileSync(path.join(result.directory, `${name}.sha256`), "utf8"), expected);
  assert.deepEqual(prepareRelease({ root: valid.root }), result, "Local preparation can be repeated without a tag");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(valid.root, "manifest.json"))), local);
  const withoutStore = fixture("without-store");
  history(withoutStore.root);
  assert.equal(prepareRelease({ root: withoutStore.root }).version, version, "Store packaging is not required");
  const first = fixture("first-release");
  const firstCommits = history(first.root, { baseline: false });
  const firstResult = prepareRelease({ root: first.root, tag: `v${version}`, repositoryUrl });
  const firstNotes = fs.readFileSync(path.join(firstResult.directory, "RELEASE_NOTES.md"), "utf8");
  assert.ok(firstNotes.includes(`feat: old baseline ([${firstCommits.old.slice(0, 7)}]`), "Without earlier tags, include the repository history");
  assert.ok(firstNotes.includes(`${repositoryUrl}/commits/v${version}`));
  const preview = fixture("preview");
  const previewCommits = history(preview.root, { currentTag: false });
  const previewResult = prepareRelease({ root: preview.root, repositoryUrl });
  assert.ok(fs.readFileSync(path.join(previewResult.directory, "RELEASE_NOTES.md"), "utf8")
    .includes(`${repositoryUrl}/compare/v1.70.3...${previewCommits.latest}`), "Untagged previews compare to the exact checked commit");
  git(preview.root, ["tag", `v${version}`, previewCommits.old]);
  assert.throws(() => prepareRelease({ root: preview.root, tag: `v${version}` }), /does not point to HEAD/);
  const shallowPath = path.join(temporary, "shallow");
  git(temporary, ["clone", "--quiet", "--depth=1", "--no-local", valid.root, shallowPath]);
  const shallow = fixture("shallow");
  assert.throws(() => prepareRelease({ root: shallow.root }), /require full Git history/);

  const rejects = (name, setup, error) => {
    const test = fixture(name);
    setup(test);
    assert.throws(() => prepareRelease({ root: test.root, tag: `v${version}` }), error);
    assert.equal(fs.existsSync(path.join(test.root, ".output/release")), false, "Validate before staging files");
  };
  const mismatch = fixture("tag-mismatch");
  assert.throws(() => prepareRelease({ root: mismatch.root, tag: "v1.70.5" }), /tag .* must match/);
  assert.throws(() => prepareRelease({ root: mismatch.root, tag: "1.70.4" }), /tag .* must match/);
  rejects("missing-root-key", ({ root }) => writeJson(path.join(root, "manifest.json"), { ...local, key: "" }), /requires a fixed public key/);
  rejects("wrong-local-key", ({ archive }) => archive({ ...local, key: "other" }), /incorrect public key policy/);
  rejects("missing-local-key", ({ archive }) => { const { key, ...manifest } = local; archive(manifest); }, /incorrect public key policy/);
  rejects("old-zip", ({ archive }) => archive({ ...local, version: "1.70.3" }), /version must match/);
  rejects("missing-resource", ({ archive }) => archive({ ...local, background: { service_worker: "missing.js" } }), /missing package files/);
  rejects("local-keys", ({ archive }) => archive(local, { ".local/keys/key": Buffer.from("private") }), /must not be packaged/);
  rejects("pem", ({ archive }) => archive(local, { "private.pem": Buffer.from("private") }), /must not be packaged/);
  rejects("missing-archive", ({ root }) => fs.unlinkSync(path.join(root, ".output", name)), /ENOENT/);
  console.log("Release preparation: archives, identity, versions, notes and checksums passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  fs.rmSync(temporary, { recursive: true, force: true });
});
