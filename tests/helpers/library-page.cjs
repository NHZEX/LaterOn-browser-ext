// Standalone DOM regressions consume WXT output, including compiled Vue SFCs.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { buildSync } = require("esbuild");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "../..");
const built = path.join(root, ".output/chrome-mv3");
const pages = new Map();

function sourceHash() {
  const hash = createHash("sha256");
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "tests" || entry.name === "docs") continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:vue|[cm]?js|ts|html|css|json|yaml)$/.test(entry.name)) hash.update(file).update(fs.readFileSync(file));
    }
  }
  visit(root);
  return hash.digest("hex");
}

function ensureBuilt() {
  const marker = path.join(root, ".output/library-test-build.json");
  const hash = sourceHash();
  let previous;
  try { previous = JSON.parse(fs.readFileSync(marker, "utf8")); } catch { /* First standalone run. */ }
  if (previous?.hash === hash && fs.existsSync(path.join(built, "library.html"))) return;
  const cli = path.resolve(path.dirname(require.resolve("wxt")), "../bin/wxt.mjs");
  const result = spawnSync(process.execPath, [cli, "build"], { cwd: root,
    env: { ...process.env, LATERON_PUBLISH: "false" }, encoding: "utf8", timeout: 60_000, windowsHide: true });
  if (result.error || result.status !== 0) throw Error(`WXT library test build failed: ${result.error || result.stdout + result.stderr}`);
  fs.writeFileSync(marker, JSON.stringify({ hash }));
}

function readPage(directory, name) {
  const html = fs.readFileSync(path.join(directory, `${name}.html`), "utf8");
  const dom = new JSDOM(html);
  const script = dom.window.document.querySelector('script[type="module"][src]');
  if (!script) throw Error(`Missing built ${name} module`);
  const entry = path.resolve(directory, `.${new URL(script.src, "https://fixture/").pathname}`);
  dom.window.close();
  // Rebundle the already-built module graph for JSDOM, which has no ES module loader.
  const { outputFiles } = buildSync({ entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser" });
  return { html, script: require("./ui-modules.cjs") + "\n" + outputFiles[0].text };
}

module.exports = function builtPage(directory, name = "library") {
  if (directory) return readPage(directory, name);
  if (!pages.has(name)) { ensureBuilt(); pages.set(name, readPage(built, name)); }
  return pages.get(name);
};

module.exports.script = function builtScript(name, directory) {
  if (!directory) ensureBuilt();
  return fs.readFileSync(path.join(directory || built, name), "utf8");
};
