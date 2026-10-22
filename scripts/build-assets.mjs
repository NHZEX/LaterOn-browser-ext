import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

export const projectRoot = new URL("../", import.meta.url);
const specification = JSON.parse(readFileSync(new URL("runtime-files.json", import.meta.url), "utf8"));
const destinations = {
  "background.js": "background-runtime.js",
  "src/shared/url-utils.js": "url-utils.js"
};

function runtimeFiles(root) {
  const { files, directories } = specification;
  return [...files, ...directories.flatMap((directory) =>
    readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/")))];
}

export function legacyAssets(root) {
  return runtimeFiles(root)
    .map((name) => ({
      absoluteSrc: resolve(root, name),
      relativeDest: destinations[name] ?? name
    }));
}
