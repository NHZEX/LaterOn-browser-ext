const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const libraryPage = require("./library-page.cjs");
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 400 && !check(); i++) await tick();
  assert.ok(check(), label);
}

module.exports = async function verifyLibraryPage(directory) {
  const page = libraryPage(directory);
  for (const language of ["zh-CN", "en"]) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    virtualConsole.on("error", error => errors.push(String(error)));
    const dom = new JSDOM(page.html, { runScripts: "outside-only", pretendToBeVisual: true,
      url: "chrome-extension://fixture/library.html", virtualConsole });
    const { window } = dom;
    const { document } = window;
    try {
      window.fetch = async () => ({});
      window.scrollTo = () => {};
      const resource = url => {
        const file = path.resolve(directory, `.${new URL(url, window.location.href).pathname}`);
        const relative = path.relative(directory, file);
        assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
        assert.ok(fs.existsSync(file), `Missing library resource: ${relative}`);
        return fs.readFileSync(file, "utf8");
      };
      for (const element of document.querySelectorAll("script[src], link[href], img[src]")) resource(element.src || element.href);
      const listeners = [];
      const item = (id, status, savedAt) => ({ id, status, read: status === "done", savedAt,
        doneAt: status === "done" ? Date.now() : null, title: `Title ${id}`, description: "Description", source: "Source",
        url: `https://example.com/${id}`, projectId: "p", image: "", favicon: "" });
      const store = { laterOnItems: [item("a", "unread", 3), item("b", "reading", 2), item("c", "done", 1)],
        laterOnProjects: [{ id: "p", name: "Project", createdAt: 1 }], laterOnActiveProject: "all",
        laterOnFilter: "unread", laterOnFilterChosen: true, laterOnOnboardingSeen: true,
        laterOnSettings: { language, theme: "dark", defaultSort: "newest", autoMarkRead: false } };
      // Own writes deliberately do not broadcast. External changes use broadcast() below.
      window.chrome = {
        storage: { local: {
          async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]]))); },
          async set(patch) { Object.assign(store, structuredClone(patch)); }
        }, onChanged: { addListener(listener) { listeners.push(listener); } } },
        runtime: { getURL: name => `chrome-extension://fixture/${name}`, onMessage: { addListener() {} },
          async sendMessage(message) { return message.type === "COLLECTION_COMMAND" ? backend.LaterOnCollection.execute(message) : {}; } },
        tabs: { async getCurrent() { return { id: 1, windowId: 1 }; }, async query() { return []; } }
      };
      const backend = vm.createContext({ chrome: window.chrome, crypto: webcrypto, Date, URL });
      vm.runInContext(resource("/storage-coordinator.js"), backend);
      const scripts = [...document.querySelectorAll("script[src]")];
      assert.equal(scripts.at(-1).type, "module");
      for (const script of scripts.filter(script => script.type !== "module")) window.eval(resource(script.src));
      await tick();
      assert.equal(document.documentElement.dataset.theme, "dark", "Theme applies before Vue mounts");
      window.eval(page.script);
      await until(() => document.querySelector(".board-card"), "Native Vue library loads projects");
      assert.equal(document.documentElement.lang, language);
      const click = selector => document.querySelector(selector).click();
      const ids = () => [...document.querySelectorAll("#cardGrid .card")].map(card => card.dataset.id).join(",");
      const search = value => {
        const input = document.querySelector("#searchInput"); input.value = value;
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      };
      click('#projectList .project-nav[data-project="p"]');
      await until(() => ids() === "a,b", "Unread includes reading");
      assert.equal(document.querySelector("#searchInput").placeholder, language === "en" ? "Search pages" : "搜索网页");
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
      assert.equal(document.activeElement.id, "searchInput");
      search("  EXAMPLE.COM/B  ");
      await until(() => ids() === "b", "Search normalizes case and whitespace and matches URL");
      click('.nav-item[data-filter="done"]');
      await until(() => ids() === "", "Search combines with reading filter");
      assert.equal(store.laterOnFilter, "done");
      assert.equal(document.querySelector('.nav-item[data-filter="done"]').getAttribute("aria-pressed"), "true");
      search("");
      await until(() => ids() === "c", "Clearing search restores project scope");
      click('.nav-item[data-filter="all"]');
      await until(() => ids() === "a,b,c", "Vue filter updates without own storage broadcast");
      const sort = document.querySelector("#sortSelect"); sort.value = "oldest";
      sort.dispatchEvent(new window.Event("change", { bubbles: true }));
      await until(() => ids() === "c,b,a" && store.laterOnSettings.defaultSort === "oldest", "Sorting renders and persists");
      assert.equal(store.laterOnSettings.autoMarkRead, false);
      assert.equal(store.laterOnSettings.language, language);
      const broadcast = patch => {
        const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: store[key], newValue }]));
        Object.assign(store, structuredClone(patch)); listeners.forEach(listener => listener(changes, "local"));
      };
      broadcast({ laterOnFilter: "unread", laterOnSettings: { ...store.laterOnSettings, defaultSort: "newest" } });
      await until(() => ids() === "a,b" && sort.value === "newest", "External filter and sorting synchronize to Vue");
      click("#selectMode");
      await tick();
      assert.equal(document.querySelector("#selectMode").getAttribute("aria-pressed"), "true");
      search("pending query");
      await tick();
      click("#homeBrand");
      await tick(180);
      assert.equal(document.querySelector("#searchInput").value, "");
      assert.equal(document.querySelector("#boardGrid").hidden, false, "Returning home cancels pending search");
      assert.equal(document.querySelector("#selectMode").hidden, true);
      assert.equal(document.querySelector("#selectMode").getAttribute("aria-pressed"), "false");
      await window.LaterOnI18n.setLanguage(language === "en" ? "zh-CN" : "en");
      await until(() => document.documentElement.lang !== language, "Language change event updates Vue controls");
      assert.equal(document.querySelector('.nav-item[data-filter="unread"]').textContent, language === "en" ? "未读" : "Unread");
      assert.deepEqual(errors, []);
    } finally { window.close(); }
  }
};
