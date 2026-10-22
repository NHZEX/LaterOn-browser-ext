const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { buildSync } = require("esbuild");
const { JSDOM, VirtualConsole } = require("jsdom");

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check, label) {
  for (let i = 0; i < 400 && !check(); i++) await tick();
  assert.ok(check(), label);
}
const clone = value => JSON.parse(JSON.stringify(value));
const payload = { format: "lateron.collection", version: 1, appVersion: "1", exportedAt: "2026-10-23T00:00:00Z", data: {
  items: [{ id: "a", url: "https://example.com/a", title: "A", projectId: "p", status: "reading", savedAt: 1,
    image: "local://a", favicon: "data:image/png;base64,BBBB" }],
  projects: [{ id: "p", name: "Project", createdAt: 1, cover: "data:image/png;base64,CCCC" }],
  covers: { a: "data:image/jpeg;base64,AAAA" }, order: { p: ["a"] }, readingPositions: { a: 123 }
} };

// Execute WXT's actual page and backend output; no custom Vue source compiler.
module.exports = async function verifySettingsPage(directory) {
  const html = fs.readFileSync(path.join(directory, "settings.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.options_page, "settings.html");
  assert.equal(manifest.options_ui, undefined);
  assert.doesNotMatch(html, /wxt\/entrypoints|src="settings\.js"|modules\/backup\/settings\.js/);
  for (const language of ["zh-CN", "en"]) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => { if (!/Not implemented: navigation/.test(error.message)) errors.push(error.message); });
    virtualConsole.on("error", error => errors.push(String(error)));
    const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true,
      url: "chrome-extension://fixture/settings.html", virtualConsole });
    const { window } = dom;
    const document = window.document;
    try {
      const resource = url => {
        const absolute = path.resolve(directory, `.${new URL(url, window.location.href).pathname}`);
        const relative = path.relative(directory, absolute);
        assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
        assert.ok(fs.existsSync(absolute), `Missing settings resource: ${relative}`);
        return absolute;
      };
      for (const element of document.querySelectorAll("script[src], link[href]")) resource(element.src || element.href);
      const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => fs.readFileSync(resource(link.href), "utf8")).join("\n");
      for (const pattern of [/--paper/, /\.settings-shell/, /\.lod-root/, /focus-visible/]) assert.match(styles, pattern);
      const scripts = [...document.querySelectorAll("script[src]")];
      assert.equal(scripts.length, 2);
      assert.match(scripts[0].src, /\/theme\.js$/);
      assert.notEqual(scripts[0].type, "module");
      assert.equal(scripts[1].type, "module");
      const store = { laterOnItems: [], laterOnProjects: [],
        laterOnSettings: { theme: "dark", language, defaultSort: "custom", libraryView: "boards" },
        laterOnDiag: { lastCommandAt: Date.now(), lastCommand: "save-all-tabs" },
        laterOnPanelDiag: { at: Date.now(), total: 500, slow: "malformed legacy diagnostics" } };
      const handlers = [], listeners = [], messages = [], downloads = [], released = [], updates = [], created = [];
      const faults = { write: false, shortcuts: false, readSettings: true };
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.chrome = {
        storage: { local: {
          async get(keys) {
            if (faults.readSettings && document.querySelector(".settings-main")) {
              faults.readSettings = false; throw Error("fixture initial settings read failure");
            }
            return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]])));
          },
          async set(patch) {
            if (faults.write) { faults.write = false; throw Error("fixture write failure"); }
            const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: store[key], newValue: value }]));
            Object.assign(store, structuredClone(patch));
            listeners.forEach(listener => listener(changes, "local"));
          }
        }, onChanged: { addListener(listener) { listeners.push(listener); } } },
        runtime: { getManifest: () => manifest, getURL: name => `chrome-extension://fixture/${name}`,
          onMessage: { addListener(listener) { handlers.push(listener); } },
          sendMessage(message) {
            messages.push(message);
            return new Promise((resolve, reject) => {
              if (!handlers.some(handler => handler(message, {}, resolve) === true)) reject(Error("Missing message handler"));
            });
          }
        },
        commands: { async getAll() { return [{ name: "quick-save", shortcut: "Alt+9" }]; } },
        tabs: {
          async getCurrent() { return { id: 7 }; },
          async update(id, patch) { updates.push({ id, ...patch }); },
          async create(patch) { if (faults.shortcuts) throw Error("fixture shortcuts failure"); created.push(patch); }
        }
      };
      const backend = vm.createContext({ chrome: window.chrome, URL, TextEncoder, crypto: webcrypto });
      for (const name of ["url-utils.js", "storage-coordinator.js", "backup-core.js", "modules/backup/background.js"])
        vm.runInContext(fs.readFileSync(path.join(directory, name), "utf8"), backend, { filename: name });
      window.Blob = Blob;
      window.URL.createObjectURL = blob => { downloads.push(blob); return "blob:fixture"; };
      window.URL.revokeObjectURL = url => released.push(url);
      window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
      window.eval(fs.readFileSync(resource(scripts[0].src), "utf8"));
      await tick();
      assert.equal(document.documentElement.dataset.theme, "dark", "Theme applies before Vue mounts");
      // JSDOM lacks ES modules; rebundle only the already-built dependency graph.
      const { outputFiles } = buildSync({ entryPoints: [resource(scripts[1].src)], bundle: true, write: false, format: "iife", platform: "browser" });
      window.eval(outputFiles[0].text);
      await until(() => document.querySelector("#retrySettings"), "Failed initial read offers retry rather than permanent loading");
      document.querySelector("#retrySettings").click();
      await until(() => document.querySelector("#exportBtn"), `Vue mounts: ${errors.join("; ")}`);
      assert.equal(document.documentElement.lang, language);
      assert.equal(document.title, language === "en" ? "LaterOn · Settings" : "LaterOn · 设置");
      assert.equal(document.querySelector('[data-setting="defaultSort"]').value, "custom");
      resource(document.querySelector(".settings-brand img").src);
      const click = selector => document.querySelector(selector).click();
      const change = (selector, value) => {
        const element = document.querySelector(selector);
        element.value = value;
        element.dispatchEvent(new window.Event("change", { bubbles: true }));
        return element;
      };
      const dialog = () => document.querySelector('[role="dialog"]');
      const closeDialog = async (confirm = true) => {
        await until(dialog, "A confirmation or result dialog opens");
        const previous = dialog();
        click(confirm ? ".lod-ok" : ".lod-cancel");
        await until(() => !previous.isConnected, "Dialog closes");
      };
      click('[data-setting="theme"] [data-value="light"]');
      await until(() => store.laterOnSettings.theme === "light", "Theme saves");
      assert.equal(document.documentElement.dataset.theme, "light");
      await tick();
      for (const [value, expected] of [["999", 180], ["32.6", 33], ["", 30]]) {
        const days = change('[data-setting="autoCleanDays"]', value);
        await until(() => store.laterOnSettings.autoCleanDays === expected, "Days clamp and round");
        assert.equal(days.value, String(expected)); await tick();
      }
      const autoClean = document.querySelector('[data-setting="autoCleanEnabled"]');
      const cleanupDays = document.querySelector('[data-setting="autoCleanDays"]');
      assert.equal(autoClean.getAttribute("aria-checked"), "true", "Legacy settings default to enabled cleanup");
      for (const id of autoClean.getAttribute("aria-describedby").split(" ")) assert.ok(document.getElementById(id).textContent);
      change('[data-setting="autoCleanDays"]', "90");
      await until(() => store.laterOnSettings.autoCleanDays === 90, "Custom cleanup days save"); await tick();
      autoClean.click();
      await until(() => store.laterOnSettings.autoCleanEnabled === false && !autoClean.disabled, "Cleanup can be disabled");
      assert.equal(autoClean.getAttribute("aria-checked"), "false");
      assert.equal(cleanupDays.disabled, true);
      assert.equal(cleanupDays.value, "90", "Disabling remembers the previous days");
      change('[data-setting="defaultSort"]', "oldest");
      await until(() => store.laterOnSettings.defaultSort === "oldest", "Sort saves"); await tick();
      assert.equal(store.laterOnSettings.autoCleanEnabled, false, "Other settings do not re-enable cleanup");
      const beforeEnable = clone(store);
      autoClean.click();
      await until(dialog, "Re-enabling requires confirmation before writing");
      assert.deepEqual(clone(store), beforeEnable, "Opening confirmation does not change settings or collection data");
      assert.equal(autoClean.getAttribute("aria-checked"), "false");
      assert.equal(cleanupDays.disabled, true);
      assert.equal(document.querySelector(".lod-title").textContent, window.LaterOnI18n.t("autoCleanConfirmTitle"));
      assert.equal(document.querySelector(".lod-message").textContent, window.LaterOnI18n.t("autoCleanConfirmMessage", { days: 90 }));
      assert.equal(document.querySelector(".lod-ok").textContent, window.LaterOnI18n.t("autoCleanConfirmButton"));
      await closeDialog(false);
      await until(() => !autoClean.disabled, "Cancel leaves the cleanup switch usable");
      assert.deepEqual(clone(store), beforeEnable, "Cancel keeps cleanup off and does not delete any data");
      autoClean.click();
      await until(dialog, "Re-enabling after cancel asks again");
      dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await until(() => !dialog() && !autoClean.disabled, "Escape dismisses confirmation");
      assert.deepEqual(clone(store), beforeEnable, "Escape keeps cleanup disabled");
      faults.write = true; autoClean.click();
      await closeDialog();
      await until(dialog, "Failed cleanup policy write opens an error");
      assert.equal(store.laterOnSettings.autoCleanEnabled, false);
      assert.equal(autoClean.getAttribute("aria-checked"), "false");
      assert.equal(cleanupDays.disabled, true);
      await closeDialog(); await tick();
      autoClean.click();
      await closeDialog();
      await until(() => store.laterOnSettings.autoCleanEnabled === true && !cleanupDays.disabled, "Cleanup can be re-enabled");
      assert.equal(cleanupDays.value, "90"); await tick();
      const singleSave = document.querySelector('[data-setting="askFolderOnSingle"]');
      assert.equal(singleSave.getAttribute("role"), "switch");
      assert.equal(singleSave.getAttribute("aria-checked"), "false");
      assert.ok(document.getElementById(singleSave.getAttribute("aria-labelledby")).textContent);
      singleSave.click();
      await until(() => store.laterOnSettings.askFolderOnSingleOptIn === true, "Switch opt-in saves"); await tick();
      assert.equal(singleSave.getAttribute("aria-checked"), "true");
      assert.equal(store.laterOnSettings.libraryView, "boards");
      await until(() => document.querySelector("#cmdSave").textContent.includes("Alt+9"), "Configured shortcut is shown");
      assert.ok(document.querySelector("#cmdSaveAll").textContent.includes("Alt+Shift+1"));
      assert.ok(document.querySelector("#diagShortcut").textContent.includes(window.LaterOnI18n.t("cmdSaveAllTabs")));
      assert.ok(document.querySelector("#diagPanelSpeed").textContent.includes(window.LaterOnI18n.t("speedOk")));
      faults.write = true; click('[data-setting="theme"] [data-value="dark"]');
      await until(dialog, "Settings write error opens dialog");
      assert.equal(store.laterOnSettings.theme, "light");
      assert.equal(document.querySelector(".lod-root").dataset.tone, "danger");
      await closeDialog(); await tick();

      const input = document.querySelector("#importFile");
      const exportButton = document.querySelector("#exportBtn");
      let selectedFileValue = "";
      Object.defineProperty(input, "value", { get: () => selectedFileValue, set: value => { selectedFileValue = value; } });
      async function startImport(text, size = 1) {
        selectedFileValue = "C:\\fakepath\\backup.json";
        Object.defineProperty(input, "files", { configurable: true, value: [{ size, async text() { return text; } }] });
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
        await until(() => exportButton.disabled, "Busy state disables backup controls");
        assert.equal(document.querySelector("#exportImages").disabled, true);
        assert.equal(document.querySelector("#wipeBtn").disabled, true);
        await until(dialog, "Import confirmation or error opens");
      }
      async function endImport() {
        await until(() => !exportButton.disabled, "Backup controls recover");
        assert.equal(input.value, "", "Same file can be selected again");
      }
      document.querySelector("#importBtn").focus();
      await startImport(JSON.stringify(payload));
      await until(() => document.activeElement.className === "lod-cancel", "Safe initial dialog focus");
      document.querySelector(".lod-ok").focus();
      document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      assert.equal(document.activeElement.className, "lod-cancel", "Tab stays inside the modal");
      assert.ok(document.querySelector(".lod-message").textContent.includes("1"));
      assert.equal(document.querySelector(".lod-ok").textContent, language === "en" ? "Merge import" : "合并导入");
      document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await endImport();
      assert.equal(store.laterOnItems.length, 0);
      assert.equal(messages.some(message => message.type === "BACKUP_APPLY"), false);
      await tick(); assert.equal(document.activeElement.id, "importBtn", "Focus returns to the initiating control");
      await startImport("\uFEFF" + JSON.stringify(payload));
      await closeDialog(); await until(dialog, "Import result opens");
      assert.equal(document.querySelector(".lod-root").dataset.tone, "success");
      assert.doesNotMatch(document.querySelector(".lod-message").textContent, /\{\w+\}/);
      await closeDialog(); await endImport();
      assert.equal(store.laterOnItems.length, 1);
      assert.equal(store.laterOnReadingPositions.a, 123);
      await tick(); assert.equal(document.activeElement.id, "importBtn", "Success dialog also restores the original focus");
      await startImport(JSON.stringify(payload));
      await closeDialog(); await closeDialog(); await endImport();
      assert.equal(store.laterOnItems.length, 1, "Repeated merge is idempotent");
      const beforeInvalid = clone(store);
      for (const [text, size] of [["{broken", 1], ["{}", 50 * 1024 * 1024 + 1], ["{}", 1]]) {
        await startImport(text, size);
        assert.equal(document.querySelector(".lod-root").dataset.tone, "danger");
        await closeDialog(); await endImport(); assert.deepEqual(clone(store), beforeInvalid);
      }
      change("#importMode", "replace");
      const replacement = clone(payload); replacement.data.items[0].title = "Restored";
      await startImport(JSON.stringify(replacement)); await closeDialog(false); await endImport();
      assert.equal(store.laterOnItems[0].title, "A", "Cancelled replacement preserves data");
      await startImport(JSON.stringify(replacement));
      assert.equal(document.querySelector(".lod-root").dataset.tone, "danger");
      assert.equal(document.querySelector(".lod-ok").textContent, window.LaterOnI18n.t("backupReplaceConfirm"));
      await closeDialog(); await closeDialog(); await endImport();
      assert.equal(store.laterOnItems[0].title, "Restored");
      assert.equal(store.laterOnSettings.libraryView, "boards");
      const beforeFailure = clone(store);
      await startImport(JSON.stringify(payload)); faults.write = true;
      await closeDialog(); await until(dialog, "Write failure opens error");
      assert.equal(document.querySelector(".lod-root").dataset.tone, "danger");
      await closeDialog(); await endImport(); assert.deepEqual(clone(store), beforeFailure);
      assert.equal(document.querySelector("#exportImages").checked, false);
      click("#exportBtn"); await tick(); await until(() => !exportButton.disabled, "Export completes");
      const exported = JSON.parse(await downloads[0].text());
      assert.equal(messages.at(-1).includeImages, false);
      assert.equal(exported.format, "lateron.collection");
      assert.equal(exported.data.items[0].title, "Restored");
      assert.equal(exported.data.readingPositions.a, 123);
      assert.deepEqual(exported.data.covers, {});
      for (const key of ["image", "favicon"]) assert.equal(exported.data.items[0][key], "");
      assert.equal(exported.data.projects[0].cover, "");
      assert.doesNotMatch(JSON.stringify(exported), /data:image/);
      assert.match(downloads[1], /^lateron-backup-.*\.json$/);
      const beforeExport = clone(store);
      click("#exportImages"); click("#exportBtn"); await tick();
      await until(() => !exportButton.disabled, "Full export completes");
      const fullExport = JSON.parse(await downloads[2].text());
      assert.equal(messages.at(-1).includeImages, true);
      assert.deepEqual(fullExport.data.covers, payload.data.covers);
      assert.equal(fullExport.data.items[0].favicon, payload.data.items[0].favicon);
      assert.equal(fullExport.data.items[0].image, payload.data.items[0].image);
      assert.equal(fullExport.data.projects[0].cover, payload.data.projects[0].cover);
      assert.deepEqual(clone(store), beforeExport);
      await startImport(JSON.stringify(exported));
      await closeDialog(); await closeDialog(); await endImport();
      assert.equal(store.laterOnItems[0].image, "");
      assert.deepEqual(clone(store.laterOnCovers), {});
      assert.equal(store.laterOnReadingPositions.a, 123);

      click("#wipeBtn"); await closeDialog(false); await endImport();
      assert.equal(store.laterOnItems.length, 1, "Cancelled wipe preserves data");
      click("#wipeBtn"); await until(dialog, "Wipe confirmation opens"); faults.write = true;
      await closeDialog(); await closeDialog(); await endImport();
      assert.equal(store.laterOnItems.length, 1, "Failed wipe preserves data");
      click("#wipeBtn"); await closeDialog(); await closeDialog(); await endImport();
      assert.equal(store.laterOnItems.length, 0);
      assert.equal(store.laterOnSettings.libraryView, "boards");
      click("#replayOnboarding"); await tick();
      assert.equal(updates.at(-1).url, "chrome-extension://fixture/library.html?guide=1");
      faults.shortcuts = true; click("#openShortcuts"); await closeDialog(); faults.shortcuts = false;
      click("#openShortcuts"); await tick(); assert.equal(created.at(-1).url, "chrome://extensions/shortcuts");
      const brand = document.querySelector("#settingsHome");
      brand.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      await tick(); assert.equal(created.at(-1).url, "chrome-extension://fixture/library.html");
      brand.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      await tick(); assert.equal(store.laterOnActiveProject, "all");
      assert.equal(updates.at(-1).url, "chrome-extension://fixture/library.html");
      let backs = 0;
      Object.defineProperty(window.history, "back", { value: () => { backs++; } });
      Object.defineProperty(window.history, "length", { value: 2 });
      document.querySelector("#back").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      assert.equal(backs, 1);
      click('[data-setting="language"] [data-value="' + (language === "en" ? "zh-CN" : "en") + '"]');
      await until(() => store.laterOnSettings.language !== language, "Language saves");
      await tick();
      assert.equal(document.documentElement.lang, language === "en" ? "zh-CN" : "en");
      await until(() => released.length === 2, "Download URLs are released");
      assert.deepEqual(errors, []);
    } finally { window.close(); }
  }
};
