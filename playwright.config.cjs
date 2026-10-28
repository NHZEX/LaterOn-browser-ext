const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.cjs",
  outputDir: ".output/browser-results",
  workers: 1,
  retries: 0,
  globalTimeout: 6 * 60_000,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { viewport: { width: 375, height: 800 }, screenshot: "only-on-failure", trace: "retain-on-failure",
    actionTimeout: 10_000, navigationTimeout: 15_000 }
});
