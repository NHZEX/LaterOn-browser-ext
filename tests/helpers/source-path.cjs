// Resolve source fixtures independently of their stable extension-package URLs.
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../..");
const sources = {
  "boot.js": "src/sidepanel/boot.js",
  "dialog.css": "src/styles/dialog.css",
  "onboarding.css": "src/styles/onboarding.css",
  "sidepanel.css": "wxt/entrypoints/sidepanel/style.css",
  "theme-vars.css": "src/styles/theme-vars.css",
  "translation.css": "src/styles/translation.css",
  "background.js": "src/background/index.js",
  "content-folder-picker.js": "wxt/entrypoints/content-folder-picker.ts",
  "content-metadata.js": "src/content/metadata.js",
  "content-reading-position.js": "src/content/reading-position.js",
  "content-translation.js": "src/content/translation.js",
  "library.css": "wxt/entrypoints/library/style.css"
};

module.exports = (name) => {
  if (sources[name]) return resolve(root, sources[name]);
  const publicFile = resolve(root, "wxt/public", name);
  return existsSync(publicFile) ? publicFile : resolve(root, name);
};
