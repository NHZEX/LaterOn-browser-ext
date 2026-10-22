import { readFileSync } from "node:fs";
import { basename, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unzipSync } from "fflate";

const projectRoot = new URL("../", import.meta.url);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function validateName(name) {
  if (
    !name || name.endsWith("/") || /(^\/|\\|:|(^|\/)\.\.?(\/|$))/.test(name) || name.endsWith(".md") || /^\.env($|\.)/.test(basename(name)) ||
    [".DS_Store", ".gitignore", "package.json", "pnpm-lock.yaml"].includes(basename(name)) ||
    /^(tests|design|docs|scripts|dist|node_modules|\.git|\.wxt|\.output)\//.test(name)
  ) throw new Error(`Development-only or invalid release file: ${name}`);
}

function validateManifest(manifest, names) {
  if (manifest.manifest_version !== 3 || typeof manifest.version !== "string" ||
      !/^\d+(\.\d+){0,3}$/.test(manifest.version) || typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("Expected a named, versioned MV3 package");
  }
  const references = [
    manifest.background?.service_worker, manifest.side_panel?.default_path, manifest.options_page, manifest.options_ui?.page,
    manifest.action?.default_popup, ...Object.values(manifest.chrome_url_overrides ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
    ...Object.values(manifest.icons ?? {}),
    ...(typeof manifest.action?.default_icon === "string" ? [manifest.action.default_icon] : Object.values(manifest.action?.default_icon ?? {})),
    ...(manifest.web_accessible_resources ?? []).flatMap((group) => group.resources ?? [])
  ];
  const missing = references.filter((name) => name && !names.some((file) => matchesGlob(file, name.replace(/^\//, ""))));
  if (missing.length) throw new Error(`Manifest references missing package files: ${missing.join(", ")}`);
  return manifest;
}

export function readReleaseArchive(archive) {
  const seen = new Set();
  const files = unzipSync(readFileSync(archive), {
    filter({ name }) {
      const key = name.toLowerCase();
      if (seen.has(key)) throw new Error(`Release ZIP contains duplicate entries: ${name}`);
      seen.add(key);
      validateName(name);
      return true;
    }
  });
  if (!files["manifest.json"]) throw new Error("Package has no manifest.json");
  const manifest = validateManifest(JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8")), Object.keys(files));
  return { files, manifest };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: pnpm release:check");
    const root = fileURLToPath(projectRoot);
    const { version } = readJson(resolve(root, "manifest.json"));
    const archive = resolve(root, ".output", `LaterOn-${version}.zip`);
    const { files, manifest } = readReleaseArchive(archive);
    console.log(`Verified ${relative(root, archive)} (${Object.keys(files).length} files, version ${manifest.version})`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
