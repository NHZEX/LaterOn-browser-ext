const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const verifyContentScripts = require("./helpers/verify-content-scripts.cjs");
const directory = path.resolve(__dirname, "../.output/chrome-mv3");

async function run() {
  const failureMode = process.argv[2];
  if (failureMode) {
    assert.ok(["unavailable", "stalled"].includes(failureMode));
    await verifyContentScripts(directory, {
      cancellationTranslator: { availability: failureMode === "unavailable"
        ? async () => "unavailable" : () => new Promise(() => {}) },
      translationStartTimeoutMs: 50
    });
    throw Error("The cancellation guard accepted a translation that never started");
  }

  require("./helpers/library-page.cjs").script("content-metadata.js");
  await verifyContentScripts(directory);
  for (const [mode, expected] of [
    ["unavailable", /Translation injection completed before translate started/],
    ["stalled", /Timed out waiting for translate to start/]
  ]) {
    // Check the exit status used by the test runner, including the former silent-success case.
    const result = spawnSync(process.execPath, [__filename, mode], {
      encoding: "utf8", timeout: 10_000, windowsHide: true
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${mode}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, expected);
  }
  console.log("PASS native webpage entry results, repeat injection, translation cancellation, failures and failure exit codes");
}

run()
  .catch(error => { console.error(error); process.exitCode = 1; });
