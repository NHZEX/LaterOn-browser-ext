import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const projectRoot = new URL("../", import.meta.url);
const specification = JSON.parse(readFileSync(new URL("runtime-files.json", import.meta.url), "utf8"));

export function runtimeFiles(root) {
  const { files, directories } = specification;
  return [...files, ...directories.flatMap((directory) =>
    readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/")))];
}

function hashes(root, names) {
  return Object.fromEntries(names.sort().map((name) => [name,
    createHash("sha256").update(readFileSync(resolve(root, name))).digest("hex")]));
}

export function inputHashes(root) {
  return hashes(root, [...runtimeFiles(root), ...specification.buildInputs]);
}

export function recordBuild(root, outputDirectory, inputs) {
  const names = [...legacyAssets(root).map((asset) => asset.relativeDest), "manifest.json", "background.js"];
  writeFileSync(resolve(root, ".wxt/compat-build.json"), JSON.stringify({
    directory: relative(root, outputDirectory).replaceAll("\\", "/"),
    inputs,
    outputs: hashes(outputDirectory, names)
  }, null, 2) + "\n");
}

export function legacyAssets(root) {
  return runtimeFiles(root)
    .filter((name) => name !== "manifest.json")
    .map((name) => ({
      absoluteSrc: resolve(root, name),
      relativeDest: name === "background.js" ? "background-runtime.js" : name
    }));
}
