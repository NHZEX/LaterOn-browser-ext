// Run each existing CommonJS test in its own process, including explicit exits.
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const tests = readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .sort();
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toUpperCase() !== "NODE_PATH"));

function run(name) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join("tests", name)], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  });
  const passed = !result.error && result.status === 0;
  console.log(`${passed ? "PASS" : "FAIL"} ${name} (${Date.now() - started} ms)`);
  if (!passed) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error.message);
    if (result.signal) console.error(`Terminated by ${result.signal}`);
  }
  return passed;
}

if (!tests.length) {
  console.error("No tests found in tests/*.test.js");
  process.exitCode = 1;
} else {
  const results = tests.map(run);
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${tests.length} test files passed`);
  if (passed !== tests.length) process.exitCode = 1;
}
