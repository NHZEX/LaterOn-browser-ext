import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readReleaseArchive } from "./check-release.mjs";

function releaseNotes(root, tag, repositoryUrl) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  if (git(["rev-parse", "--is-shallow-repository"]) === "true") throw new Error("Release notes require full Git history; fetch with fetch-depth: 0");
  const head = git(["rev-parse", "HEAD"]);
  if (tag && git(["rev-parse", `refs/tags/${tag}^{commit}`]) !== head) throw new Error(`Release tag ${tag} does not point to HEAD`);
  const currentTags = new Set(git(["tag", "--points-at", head]).split("\n"));
  const previousTags = git(["tag", "--merged", head]).split("\n")
    .filter(name => /^v\d+(\.\d+){0,3}$/.test(name) && !currentTags.has(name));
  const previous = previousTags.length
    ? git(["describe", "--tags", "--abbrev=0", ...previousTags.flatMap(name => ["--match", name]), head])
    : undefined;
  const range = previous ? `${previous}..${head}` : head;
  const commits = git(["log", "--reverse", "--format=%H%x00%s", range]).split("\n").filter(Boolean);
  const entries = commits.map(commit => {
    const [sha, subject] = commit.split("\0");
    const title = subject.replace(/([\\`*_[\]<>])/g, "\\$1");
    const reference = repositoryUrl ? `[${sha.slice(0, 7)}](${repositoryUrl}/commit/${sha})` : sha.slice(0, 7);
    return `- ${title} (${reference})`;
  });
  const target = tag ?? head;
  const comparison = previous ? `compare/${previous}...${target}` : `commits/${target}`;
  const footer = repositoryUrl ? `\n\n[Full Changelog](${repositoryUrl}/${comparison})` : "";
  return `## Changes${previous ? ` since ${previous}` : ""}\n\n${entries.join("\n") || "No new commits."}${footer}\n`;
}

// Collect the existing local WXT ZIP; release jobs publish these exact checked bytes.
export function prepareRelease({
  root = fileURLToPath(new URL("../", import.meta.url)), tag,
  repositoryUrl = process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}` : undefined
} = {}) {
  const source = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  const { version, key } = source;
  if (typeof version !== "string" || !/^\d+(\.\d+){0,3}$/.test(version)) throw new Error("Invalid source manifest version");
  if (tag !== undefined && tag !== `v${version}`) throw new Error(`Release tag ${tag} must match v${version}`);
  if (typeof key !== "string" || !key.trim()) throw new Error("The local package requires a fixed public key");

  const name = `LaterOn-${version}.zip`;
  const archive = resolve(root, ".output", name);
  const { files, manifest } = readReleaseArchive(archive);
  if (manifest.version !== version) throw new Error(`${name}: version must match ${version}`);
  if (manifest.key !== key) throw new Error(`${name}: incorrect public key policy`);
  if (Object.keys(files).some(file => file.startsWith(".local/") || /\.(pem|pub)$/i.test(file))) {
    throw new Error(`${name}: local key files must not be packaged`);
  }
  const notes = releaseNotes(root, tag, repositoryUrl);
  const bytes = readFileSync(archive);
  const checksum = `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`;

  const directory = resolve(root, ".output/release");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, name), bytes);
  writeFileSync(resolve(directory, `${name}.sha256`), checksum);
  writeFileSync(resolve(directory, "RELEASE_NOTES.md"), notes);
  return { version, directory };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--tag")) throw new Error("Usage: pnpm release:prepare [--tag vVERSION]");
    const result = prepareRelease({ tag: args[1] });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\n`);
    console.log(`Prepared release ${result.version} in ${result.directory}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
