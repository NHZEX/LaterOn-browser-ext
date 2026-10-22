import { readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { fileHashes, inputHashes, legacyAssets, outputFiles, projectRoot } from "./build-assets.mjs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const assertSame = (actual, expected, message) => {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
};

function validateNames(names, expected, label) {
  assertSame(names.toSorted(), expected.toSorted(), `${label} differs from allowlist`);
  const forbidden = names.find((name) =>
    /(^\/|\\|:|(^|\/)\.\.?(\/|$))/.test(name) || name.endsWith(".md") ||
    [".DS_Store", "icon.svg", "popup.html", "popup.js", "popup.css"].includes(basename(name)) ||
    /^(tests|design|scripts|dist|\.git|\.wxt|\.output)\//.test(name));
  if (forbidden) throw new Error(`Development-only or invalid release file: ${forbidden}`);
}

function validateManifest(root, outputDirectory, names) {
  const manifest = readJson(resolve(outputDirectory, "manifest.json"));
  assertSame(manifest, readJson(resolve(root, "manifest.json")), "WXT manifest differs from the extension manifest");
  if (!manifest.version?.trim()) throw new Error("manifest.json has no version");
  const references = [
    manifest.background?.service_worker, manifest.side_panel?.default_path, manifest.options_page,
    ...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.web_accessible_resources ?? []).flatMap((group) => group.resources ?? [])
  ];
  const missing = references.filter((name) => name && !names.includes(name));
  if (missing.length) throw new Error(`Manifest references files outside the release allowlist: ${missing.join(", ")}`);
  return manifest;
}

export function validateBuild(root, outputDirectory) {
  const names = outputFiles(root);
  const actual = readdirSync(outputDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(outputDirectory, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/"));
  validateNames(actual, names, "WXT output");
  const state = readJson(resolve(root, ".wxt/compat-build.json"));
  assertSame(state.directory, relative(root, outputDirectory).replaceAll("\\", "/"), "WXT build directory differs from recorded output");
  assertSame(state.inputs, inputHashes(root), "WXT build is stale; run pnpm build");
  assertSame(state.outputs, fileHashes(outputDirectory, names), "WXT build output was modified; run pnpm build");
  const manifest = validateManifest(root, outputDirectory, names);
  const changed = legacyAssets(root).filter(({ absoluteSrc, relativeDest }) =>
    !readFileSync(absoluteSrc).equals(readFileSync(resolve(outputDirectory, relativeDest))));
  if (changed.length) throw new Error(`WXT changed legacy runtime files: ${changed.map((asset) => asset.relativeDest).join(", ")}`);
  return { names, manifest };
}

export function validateArchive(root, outputDirectory, archive) {
  const { names, manifest } = validateBuild(root, outputDirectory);
  const seen = new Set();
  const files = unzipSync(readFileSync(archive), {
    filter({ name }) {
      if (seen.has(name)) throw new Error(`Release ZIP contains duplicate entries: ${name}`);
      seen.add(name);
      if (!names.includes(name)) throw new Error(`Release ZIP differs from allowlist: ${name}`);
      return true;
    }
  });
  validateNames(Object.keys(files), names, "Release ZIP");
  const changed = names.filter((name) => !readFileSync(resolve(outputDirectory, name)).equals(files[name]));
  if (changed.length) throw new Error(`Release ZIP differs from current build: ${changed.join(", ")}`);
  console.log(`Verified ${relative(root, archive)} (${names.length} files, version ${manifest.version})`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: pnpm release:check");
    const root = fileURLToPath(projectRoot);
    const { version } = readJson(resolve(root, "manifest.json"));
    validateArchive(root, resolve(root, ".output/chrome-mv3"), resolve(root, ".output", `LaterOn-${version}.zip`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
