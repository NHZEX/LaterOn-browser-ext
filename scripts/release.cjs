// Build with WXT, then validate and package its output reproducibly.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const [command, ...args] = process.argv.slice(2);
const windows = process.platform === "win32";
const buildDirectory = path.join(root, ".output", "chrome-mv3");

function execute(executable, parameters) {
  const result = spawnSync(executable, parameters, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) console.error(result.error.message);
  return result.error ? 1 : result.status ?? 1;
}

function packageRelease(parameters) {
  return execute(windows ? "py" : "python3", [
    ...(windows ? ["-3.12"] : []), "-B", "scripts/build-release.py", "--source-dir", buildDirectory, ...parameters
  ]);
}

async function buildRelease(parameters) {
  const { build } = await import("wxt");
  await build({ root, browser: "chrome", manifestVersion: 3, mode: "production" });
  return packageRelease(parameters);
}

async function publish(parameters) {
  if (parameters.length !== 2 || parameters[0] !== "--dir" || !parameters[1].trim()) {
    console.error('Usage: pnpm run release:local --dir "D:\\浏览器扩展\\LaterOn"');
    return 1;
  }
  const destination = path.resolve(parameters[1]);
  const built = await buildRelease([]);
  if (built !== 0) return built;
  const { version } = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  return execute("pwsh", [
    "-NoProfile", "-File", path.join(__dirname, "publish-local.ps1"),
    "-Archive", path.join(root, "dist", `LaterOn-${version}.zip`),
    "-Destination", destination
  ]);
}

async function main() {
  if (command === "build") process.exitCode = await buildRelease(args);
  else if (command === "check") process.exitCode = packageRelease(["--check", ...args]);
  else if (command === "publish") process.exitCode = await publish(args);
  else {
    console.error("Expected build, check or publish");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
