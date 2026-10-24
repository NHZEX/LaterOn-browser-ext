const path = require("node:path");
const { test: base, chromium, expect } = require("@playwright/test");

const buildDir = path.resolve(__dirname, "../../.output/chrome-mv3");
const test = base.extend({
  context: async ({ viewport, colorScheme }, use) => {
    // Empty userDataDir lets Playwright create and remove a fresh temporary profile per test.
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", headless: true, viewport, colorScheme,
      args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`]
    });
    try { await use(context); }
    finally { await context.close(); }
  },
  extension: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    await use({ worker, url: `chrome-extension://${id}/sidepanel.html` });
  }
});

module.exports = { test, expect, buildDir };
