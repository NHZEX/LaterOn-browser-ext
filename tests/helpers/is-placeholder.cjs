const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const expected = fs.readFileSync(path.join(root, "article-cover-placeholder.png"));

// Asset names may be hashed by Vite; verify the actual displayed resource bytes.
module.exports = function isPlaceholder(image) {
  if (!image?.src) return false;
  const file = path.resolve(root, ".output/chrome-mv3", `.${new URL(image.src, image.ownerDocument.baseURI).pathname}`);
  return fs.existsSync(file) && fs.readFileSync(file).equals(expected);
};
