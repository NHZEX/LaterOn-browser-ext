// Resolve source fixtures independently of their stable extension-package URLs.
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const runtime = require("../../scripts/runtime-files.json");

const root = resolve(__dirname, "../..");
const sources = {
  ...runtime,
  "background.js": "src/background/index.js",
  "library.css": "wxt/entrypoints/library/style.css"
};

module.exports = (name) => {
  if (sources[name]) return resolve(root, sources[name]);
  const publicFile = resolve(root, "wxt/public", name);
  return existsSync(publicFile) ? publicFile : resolve(root, name);
};
