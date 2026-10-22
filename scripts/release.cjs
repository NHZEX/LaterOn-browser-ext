// Keep the existing reproducible packager behind a shared project CLI.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const [command, ...args] = process.argv.slice(2);
const windows = process.platform === "win32";

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
    ...(windows ? ["-3.12"] : []), "-B", "scripts/build-release.py", ...parameters
  ]);
}

function publish(parameters) {
  if (parameters.length !== 2 || parameters[0] !== "--dir" || !parameters[1].trim()) {
    console.error('Usage: pnpm run release:local --dir "D:\\浏览器扩展\\LaterOn"');
    return 1;
  }
  const destination = path.resolve(parameters[1]);
  const built = packageRelease([]);
  if (built !== 0) return built;
  const { version } = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  return execute("pwsh", [
    "-NoProfile", "-File", path.join(__dirname, "publish-local.ps1"),
    "-Archive", path.join(root, "dist", `LaterOn-${version}.zip`),
    "-Destination", destination
  ]);
}

try {
  if (command === "build") process.exitCode = packageRelease(args);
  else if (command === "check") process.exitCode = packageRelease(["--check", ...args]);
  else if (command === "publish") process.exitCode = publish(args);
  else {
    console.error("Expected build, check or publish");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
