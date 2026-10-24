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
      const commands = [];
      let failProjectWrite = false;
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
          async sendMessage(message) {
            if (message.type !== "COLLECTION_COMMAND") return {};
            commands.push(structuredClone(message));
            if (failProjectWrite && message.action === "updateProject") {
              failProjectWrite = false;
              return { ok: false, error: "Project write fixture failure" };
            }
            return backend.LaterOnCollection.execute(message);
          } },
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
      assert.equal(document.querySelector(".sidebar-slogan").textContent, window.LaterOnI18n.t("slogan"));
      assert.equal(document.querySelector('.top-entry > span:last-of-type').textContent, window.LaterOnI18n.t("allProjectsOverview"));
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
      assert.equal(document.querySelector(".sidebar-slogan").textContent, window.LaterOnI18n.t("slogan"));
      assert.equal(document.querySelector('.top-entry > span:last-of-type').textContent, window.LaterOnI18n.t("allProjectsOverview"));
      assert.equal(document.querySelector('.board-meta').textContent, language === "en" ? "3 篇 · 2 没看完" : "3 saves · 2 unfinished");

      const row = id => document.querySelector(`#projectList .project-row[data-id="${id}"]`);
      const board = id => document.querySelector(`.board-card[data-project="${id}"]`);
      const project = () => store.laterOnProjects.find(project => project.id === "p");
      const projectPatch = changes => store.laterOnProjects.map(project => project.id === "p" ? { ...project, ...changes } : project);
      const input = (element, value) => { element.value = value; element.dispatchEvent(new window.Event("input", { bubbles: true })); };
      const key = (element, value) => element.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
      const rename = async () => {
        row("p").querySelector(".project-nav").dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
        await until(() => document.querySelector(".project-rename"), "Vue rename input appears");
        return document.querySelector(".project-rename");
      };
      const menu = (element, label) => {
        element.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        const action = [...document.querySelectorAll('.folder-menu-item')].find(item => item.textContent === window.LaterOnI18n.t(label));
        assert.ok(action, `Menu action ${label}`); action.click();
      };
      broadcast({ laterOnProjects: [...store.laterOnProjects, { id: "empty", name: "Empty", createdAt: 2 },
        { id: "hidden", name: "Archived pin", createdAt: 3, pinned: true, archived: true }] });
      await until(() => board("empty"), "External project creation updates Vue boards");
      assert.equal(row("hidden"), null);
      assert.equal(document.querySelector('.project-pin-sep'), null, "Archived pins do not create a stray separator");
      menu(board("empty"), "pinProject");
      await until(() => document.querySelector('.board-card').dataset.project === "empty", "Own pin updates board order without a storage broadcast");
      assert.equal(document.querySelector('#projectList .project-row').dataset.id, "empty");
      assert.equal(document.querySelectorAll('.project-pin-sep').length, 1);
      assert.equal(commands.filter(command => command.action === "setProjectPinned").length, 1, "No duplicate menu or row listeners");

      const stableRow = row("p");
      const nameInput = await rename();
      assert.equal(document.activeElement, nameInput);
      input(nameInput, "Renamed project");
      nameInput.setSelectionRange(2, 6);
      broadcast({ laterOnItems: [...store.laterOnItems, { ...item("d", "unread", 4) }] });
      await until(() => row("p").querySelector('.nav-count').textContent === "4", "External item updates project count");
      assert.equal(row("p"), stableRow, "Vue preserves keyed project rows");
      assert.equal(document.querySelector('.project-rename'), nameInput);
      assert.equal(document.activeElement, nameInput, "External synchronization preserves rename focus");
      assert.equal(nameInput.value, "Renamed project");
      assert.deepEqual([nameInput.selectionStart, nameInput.selectionEnd], [2, 6]);
      key(nameInput, "Enter");
      await until(() => project().name === "Renamed project" && board("p").querySelector('.board-name').textContent === "Renamed project", "Own rename updates storage, navigation and boards without a broadcast");
      assert.equal(commands.filter(command => command.action === "updateProject").length, 1);
      const cancelled = await rename(); input(cancelled, "Discarded name"); key(cancelled, "Escape"); await tick();
      assert.equal(document.querySelector('.project-rename'), null);
      assert.equal(project().name, "Renamed project");
      failProjectWrite = true;
      const failed = await rename(); input(failed, "Retry name"); key(failed, "Enter");
      await until(() => document.querySelector('#toast').textContent === window.LaterOnI18n.t("operationFailed"), "Rename failure is reported");
      assert.equal(project().name, "Renamed project");
      assert.equal(row("p").querySelector('.project-name').textContent, "Renamed project");
      const retry = await rename(); input(retry, "Retry name"); retry.blur();
      await until(() => project().name === "Retry name" && board("p").querySelector('.board-name').textContent === "Retry name", "Rename can be retried after failure");

      const video = "https://i.ytimg.com/vi/fixture/";
      broadcast({ laterOnProjects: projectPatch({ coverPick: ["a"] }), laterOnItems: store.laterOnItems.map(item => item.id === "a" ? { ...item, image: `${video}maxresdefault.jpg` } : item) });
      await until(() => board("p").querySelector('.board-img'), "External image changes update boards");
      row("p").querySelector('.project-thumb img').dispatchEvent(new window.Event("error")); await tick();
      assert.equal(row("p").querySelector('.project-ph').textContent, "R", "Failed thumbnail uses the project initial");
      for (const file of ["hq720.jpg", "hqdefault.jpg", "mqdefault.jpg"]) {
        board("p").querySelector('.board-img').dispatchEvent(new window.Event("error")); await tick();
        assert.equal(board("p").querySelector('.board-img').src, `${video}${file}`);
      }
      board("p").querySelector('.board-img').dispatchEvent(new window.Event("error")); await tick();
      assert.ok(board("p").querySelector('.board-placeholder'));
      resource(board("p").querySelector('.board-placeholder').src);
      const localCover = "data:image/png;base64,AAAA";
      broadcast({ laterOnCovers: { fixture: localCover }, laterOnItems: store.laterOnItems.map(item => item.id === "a" ? { ...item, image: "local://fixture" } : item) });
      await until(() => row("p").querySelector('.project-thumb img')?.src === localCover, "A new source resets failed thumbnails");
      assert.equal(board("p").querySelector('.board-img').src, localCover, "A new source resets exhausted board fallbacks");
      broadcast({ laterOnProjects: projectPatch({ cover: "https://example.com/missing-project.jpg" }) }); await tick();
      board("p").querySelector('.board-img').dispatchEvent(new window.Event("error")); await tick();
      assert.ok(board("p").querySelector('.board-placeholder'), "Custom project covers also fail safely");

      menu(board("p"), "archiveProject");
      await until(() => project().archived && !row("p") && board("p"), "Own archive updates both Vue views without a broadcast");
      assert.equal(board("p").draggable, false);
      assert.equal(document.querySelector('#allCount').textContent, "0");
      menu(board("p"), "restoreProject");
      await until(() => !project().archived && row("p") && document.querySelector('.card'), "Restore selects the project and restores navigation");
      assert.equal(row("p").querySelector('.project-nav').classList.contains("active"), true);
      key(document, "F2"); await until(() => document.querySelector('.project-rename'), "F2 starts inline rename in the active project");
      key(document.querySelector('.project-rename'), "Escape"); await tick();

      click('.project-nav[data-project="all"]');
      await until(() => board("p"), "Return to boards before dragging");
      const dragEvent = (element, type, transfer, x = 10, y = 10) => {
        const event = new window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { dataTransfer: transfer, clientX: x, clientY: y }); element.dispatchEvent(event);
      };
      const transfer = () => {
        const data = new Map();
        return { types: [], setData(type, value) { data.set(type, value); this.types.push(type); },
          getData(type) { return data.get(type) ?? ""; }, setDragImage() {} };
      };
      [...document.querySelectorAll('.board-card')].forEach((element, index) => {
        element.getBoundingClientRect = () => ({ left: index * 280, top: 0, right: index * 280 + 260, bottom: 300, width: 260, height: 300 });
      });
      const moves = () => commands.filter(command => command.action === "moveProject").length;
      const beforeMoves = moves();
      const boardTransfer = transfer();
      dragEvent(board("p"), "dragstart", boardTransfer, 290, 10);
      assert.ok(document.querySelector('.drag-home-frame'));
      // Synchronize before the scheduled drag animation frame as well as Vue's update.
      broadcast({ laterOnProjects: projectPatch({ name: "External name" }) }); await tick(30);
      assert.equal(board("p").querySelector('.board-name').textContent, "External name");
      assert.equal(document.querySelector('.drag-home-frame, .drag-preview, .dragging'), null, "External changes clean up board drag before Vue reconciles");
      dragEvent(document.querySelector('#boardGrid'), "drop", boardTransfer); await tick();
      assert.equal(moves(), beforeMoves, "A cancelled drag cannot persist a stale order");
      const folderTransfer = transfer();
      dragEvent(row("p"), "dragstart", folderTransfer);
      dragEvent(document.querySelector('#projectList'), "dragover", folderTransfer, 10, 500);
      assert.ok(document.querySelector('.folder-drop-line'));
      broadcast({ laterOnProjects: [...store.laterOnProjects, { id: "fresh", name: "New project", createdAt: 4 }] }); await tick();
      assert.ok(row("fresh"));
      assert.equal(document.querySelector('.folder-drop-line, .folder-drag-preview, .is-sorting'), null, "External changes clear sidebar drag nodes before Vue adds rows");
      dragEvent(document.querySelector('#projectList'), "drop", folderTransfer); await tick();
      assert.equal(moves(), beforeMoves);
      [...document.querySelectorAll('#projectList .project-row')].forEach((element, index) => {
        element.getBoundingClientRect = () => ({ left: 0, top: index * 40, right: 200, bottom: index * 40 + 36, width: 200, height: 36 });
      });
      const reordered = transfer();
      dragEvent(row("fresh"), "dragstart", reordered);
      dragEvent(document.querySelector('#projectList'), "dragover", reordered, 10, 42);
      dragEvent(document.querySelector('#projectList'), "drop", reordered);
      await until(() => [...document.querySelectorAll('#projectList .project-row')].map(row => row.dataset.id).join(',') === "empty,fresh,p", "Sidebar drop uses visible rows even when archived pins are hidden");
      assert.equal(moves(), beforeMoves + 1);
      assert.equal([...document.querySelectorAll('.board-card')].map(card => card.dataset.project).join(','), "empty,fresh,p", "Sidebar order synchronizes to Vue boards");
      assert.deepEqual(errors, []);
    } finally { window.close(); }
  }
};
