const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");
const { JSDOM, VirtualConsole } = require("jsdom");

const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual HTML and its compiled module graph, without source path assumptions.
module.exports = async function verifySettingsPage(directory) {
  const html = fs.readFileSync(path.join(directory, "settings.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.options_page, "settings.html");
  assert.equal(manifest.options_ui, undefined, "The native entry retains the existing settings URL");
  assert.doesNotMatch(html, /wxt\/entrypoints|src="settings\.js"|src="modules\/backup\/settings\.js"/);

  for (const language of ["zh-CN", "en"]) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "chrome-extension://fixture/settings.html", virtualConsole });
    const { window } = dom;
    try {
      const document = window.document;
      const resource = url => {
        const absolute = path.resolve(directory, `.${new URL(url, window.location.href).pathname}`);
        const relative = path.relative(directory, absolute);
        assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
        assert.ok(fs.existsSync(absolute), `Missing native settings resource: ${relative}`);
        return absolute;
      };
      for (const element of document.querySelectorAll("script[src], link[href], img[src]")) resource(element.src || element.href);
      const styles = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map(link => fs.readFileSync(resource(link.href), "utf8")).join("\n");
      assert.match(styles, /--paper/);
      assert.match(styles, /\.settings-shell/);
      assert.match(styles, /\.lod-root/);
      const scripts = [...document.querySelectorAll("script[src]")];
      assert.equal(scripts.length, 2, "One early theme script precedes one native module entry");
      assert.match(scripts[0].src, /\/theme\.js$/);
      assert.notEqual(scripts[0].type, "module");
      assert.equal(scripts[1].type, "module");

      const store = { laterOnSettings: { theme: "dark", language, defaultSort: "custom", libraryView: "boards" } };
      const listeners = [], messages = [], downloads = [], confirms = [], alerts = [], updates = [];
      const payload = { format: "lateron.collection", version: 1, exportedAt: "2026-10-23T00:00:00Z",
        data: { items: [], projects: [], covers: {}, order: {}, readingPositions: {} } };
      window.chrome = {
        storage: { local: {
          async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(store[key])])); },
          async set(patch) {
            const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: store[key], newValue: value }]));
            Object.assign(store, structuredClone(patch));
            listeners.forEach(listener => listener(changes, "local"));
          }
        }, onChanged: { addListener(listener) { listeners.push(listener); } } },
        runtime: {
          getURL: name => `chrome-extension://fixture/${name}`,
          async sendMessage(message) {
            messages.push(message);
            if (message.type === "BACKUP_EXPORT") return { ok: true, payload };
            if (message.type === "BACKUP_PREVIEW") return { ok: true, token: "preview", incoming: { items: 0, projects: 0 },
              current: { items: 0, projects: 0 }, added: 0, addedProjects: 0, duplicates: 0 };
            return { ok: true, total: 0, added: 0, addedProjects: 0, duplicates: 0 };
          }
        },
        commands: { async getAll() { return []; } },
        tabs: {
          async getCurrent() { return { id: 7 }; },
          async update(id, patch) { updates.push({ id, ...patch }); }
        }
      };
      window.Blob = Blob;
      window.URL.createObjectURL = blob => { downloads.push(blob); return "blob:fixture"; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
      window.eval(fs.readFileSync(resource(scripts[0].src), "utf8"));
      await tick();
      assert.equal(document.documentElement.dataset.theme, "dark", "Theme applies before the native page module");
      // jsdom does not execute ES modules; bundle only the built dependency graph for evaluation.
      const { outputFiles } = buildSync({ entryPoints: [resource(scripts[1].src)], bundle: true, write: false, format: "iife", platform: "browser" });
      window.eval(outputFiles[0].text);
      await tick();
      assert.equal(document.documentElement.lang, language === "en" ? "en" : "zh-CN");
      assert.equal(document.title, language === "en" ? "LaterOn · Settings" : "LaterOn · 设置");
      assert.equal(document.querySelector('[data-setting="defaultSort"]').value, "custom");
      assert.equal(typeof window.LaterOnDialog.confirm, "function");
      document.querySelector('[data-setting="theme"] [data-value="light"]').click();
      await tick();
      assert.equal(store.laterOnSettings.theme, "light");
      assert.equal(document.documentElement.dataset.theme, "light");
      const days = document.querySelector('[data-setting="autoCleanDays"]');
      days.value = "999";
      days.dispatchEvent(new window.Event("change"));
      await tick();
      assert.equal(store.laterOnSettings.autoCleanDays, 180);
      const singleSave = document.querySelector('[data-setting="askFolderOnSingle"]');
      singleSave.checked = true;
      singleSave.dispatchEvent(new window.Event("change"));
      await tick();
      assert.equal(store.laterOnSettings.askFolderOnSingleOptIn, true);
      assert.equal(store.laterOnSettings.libraryView, "boards");

      window.LaterOnDialog.confirm = async config => { confirms.push(config); return true; };
      window.LaterOnDialog.alert = async config => { alerts.push(config); };
      const exportButton = document.querySelector("#exportBtn");
      assert.equal(document.querySelector("#exportImages").checked, false);
      exportButton.click();
      await tick();
      assert.equal(messages.at(-1).type, "BACKUP_EXPORT");
      assert.equal(messages.at(-1).includeImages, false);
      assert.equal(JSON.parse(await downloads[0].text()).format, "lateron.collection");
      assert.match(downloads[1], /^lateron-backup-.*\.json$/);
      assert.equal(exportButton.disabled, false);
      const input = document.querySelector("#importFile");
      Object.defineProperty(input, "files", { value: [{ size: 1, async text() { return JSON.stringify(payload); } }] });
      input.dispatchEvent(new window.Event("change"));
      await tick();
      assert.deepEqual(messages.slice(-2).map(message => message.type), ["BACKUP_PREVIEW", "BACKUP_APPLY"]);
      assert.equal(confirms[0].confirmText, language === "en" ? "Merge import" : "合并导入");
      assert.equal(alerts.at(-1).tone, "success");
      assert.equal(exportButton.disabled, false);
      assert.equal(input.value, "");
      document.querySelector("#settingsHome").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      await tick();
      assert.equal(store.laterOnActiveProject, "all");
      assert.equal(updates[0].url, "chrome-extension://fixture/library.html");
      assert.deepEqual(errors, []);
    } finally { window.close(); }
  }
};
