import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readReleaseArchive } from "./check-release.mjs";

const root = fs.realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = (path) => { try { return fs.lstatSync(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } };
const inside = (path, directory) => {
  const name = relative(directory, path);
  return !isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`);
};

function assertDirectory(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a normal directory: ${path}`);
}

function inventory(directory) {
  return Object.fromEntries(fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => {
      if (entry.isSymbolicLink()) throw new Error(`Installation contains a symbolic link: ${entry.name}`);
      return entry.isFile();
    })
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(directory, path).replaceAll("\\", "/"), digest(fs.readFileSync(path))];
    }));
}

function assertInventory(directory, expected) {
  if (!isDeepStrictEqual(inventory(directory), expected)) throw new Error(`File/hash mismatch: ${directory}`);
}

function destinationPath(destination) {
  const target = resolve(destination);
  if (dirname(target) === target) throw new Error("Destination must name an extension directory");
  // Resolve the parent before any rename, including paths through directory links.
  const parent = fs.realpathSync(dirname(target));
  const canonical = join(parent, basename(target));
  if (inside(root, canonical)) throw new Error("Cannot replace the project directory or its ancestors");
  assertDirectory(parent);
  return canonical;
}

function swapDirectories(target, stage, backup, hasPrevious) {
  if (hasPrevious) fs.renameSync(target, backup);
  try {
    fs.renameSync(stage, target);
  } catch (error) {
    if (!hasPrevious) throw error;
    try {
      fs.renameSync(backup, target);
    } catch (rollbackError) {
      throw Object.assign(new Error(`Deployment failed: ${error.message}; rollback failed: ${rollbackError.message}. Inspect ${backup} and ${stage}`), { rollbackFailed: true });
    }
    throw error;
  }
}

export function publishLocal({ archive, destination }) {
  const target = destinationPath(destination);
  const { files, manifest } = readReleaseArchive(archive);
  const expected = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)]));
  const existing = exists(target);
  if (existing) {
    assertDirectory(target);
    const old = readJson(join(target, "manifest.json"));
    if (typeof old.version !== "string" || old.name !== manifest.name) throw new Error("Existing directory is not the same extension");
  }
  const previous = existing ? inventory(target) : undefined;
  if (previous && isDeepStrictEqual(previous, expected)) {
    console.log(`Already installed: ${target} (${manifest.version}, ${Object.keys(files).length} files, SHA-256 verified)`);
    return;
  }

  const parent = dirname(target);
  const leaf = relative(parent, target);
  const token = randomUUID().slice(0, 8);
  const stage = join(parent, `.${leaf}-stage-${token}`);
  const backupRoot = join(parent, `${leaf}-backups`);
  if (!inside(stage, parent) || !inside(backupRoot, parent)) throw new Error("Deployment path escapes parent directory");
  if (exists(backupRoot)) assertDirectory(backupRoot);
  const oldVersion = existing ? readJson(join(target, "manifest.json")).version.replace(/[^\w.-]/g, "_") : "";
  const backup = join(backupRoot, `${oldVersion}-${new Date().toISOString().replace(/[:.]/g, "-")}-${token}`);
  fs.mkdirSync(stage);
  try {
    Object.entries(files).forEach(([name, bytes]) => {
      const path = resolve(stage, name);
      if (!inside(path, stage)) throw new Error(`Package path escapes staging directory: ${name}`);
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(path, bytes);
    });
    assertInventory(stage, expected);
    if (existing) fs.mkdirSync(backupRoot, { recursive: true });
    swapDirectories(target, stage, backup, Boolean(previous));
  } catch (error) {
    // Preserve both directories for recovery when rollback itself cannot finish.
    if (!error.rollbackFailed && exists(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  console.log(`Published: ${target} (${manifest.version}, ${Object.keys(files).length} files, SHA-256 verified against ZIP)`);
  if (previous) console.log(`Backup: ${backup} (previous directory preserved)`);
}
