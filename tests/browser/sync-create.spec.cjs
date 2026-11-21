const { createServer } = require("node:http");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { gunzipSync, gzipSync } = require("node:zlib");
const { format } = require("node:url");
const { chromium } = require("@playwright/test");
const { test, expect, buildDir } = require("./extension.cjs");

const acceptance = process.env.STAYSIDE_SYNC_ACCEPTANCE === "1";
const folder = "/fixture-sync/";
const regionName = "WebDAV sync acceptance";
const coverImage = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const listing = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${folder}</d:href><d:propstat>
<d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status>
</d:propstat></d:response></d:multistatus>`;

const actualListing = files => listing.replace('</d:multistatus>', Array.from(files.keys(), url =>
  `<d:response><d:href>${url}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('') + '</d:multistatus>');

test("普通构建不开放同步验收入口", async ({ page, extension }) => {
  test.skip(acceptance, "Default build only");
  await extension.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" } }));
  await page.goto(new URL("settings.html#backup", extension.url).href);
  await expect(page.getByRole("region", { name: "Backup & restore" })).toBeVisible();
  await expect(page.getByRole("region", { name: "WebDAV sync acceptance" })).toHaveCount(0);
  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: "LATERON_SYNC_ACCEPTANCE", action: "status" })
    .catch(() => null));
  expect(status ?? null).toBeNull();
});

async function withDav(run) {
  const dav = { requests: [], files: new Map(), listing: '<d:multistatus xmlns:d="DAV:"/>' };
  const server = createServer(async (request, response) => {
    const { method, url, headers } = request;
    if (method === "GET" && [`${folder}article`, `${folder}offline-addition`].includes(url)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<title>Reading</title><main style="height:5000px">Article</main>');
      return;
    }
    dav.requests.push({ method, url, headers });
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (dav.offline) { response.writeHead(503).end(); return; }
    if (method === "PROPFIND") response.writeHead(207).end(dav.discover ? actualListing(dav.files) : dav.listing);
    else if (method === "PUT") {
      await dav.beforePut?.(url);
      dav.files.set(url, Buffer.concat(chunks));
      response.writeHead(201).end();
    } else if (method === "GET") {
      const bytes = dav.files.get(url);
      await dav.beforeGet?.(url);
      if (bytes && dav.corruptSnapshot && url.endsWith(".gz")) {
        const snapshot = JSON.parse(gunzipSync(bytes));
        snapshot.state.members[0].title.value = "Different title";
        response.writeHead(200).end(gzipSync(JSON.stringify(snapshot)));
      } else response.writeHead(bytes ? 200 : 404).end(bytes);
    } else response.writeHead(405).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { address, port } = server.address();
  const endpoint = format({ protocol: "http", hostname: address, port, pathname: folder });
  try { await run(dav, endpoint); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function openPanel(page, extension, endpoint) {
  const url = new URL("article", endpoint).href;
  await extension.worker.evaluate(url => chrome.storage.local.set({ laterOnSettings: { language: "en" },
    laterOnItems: [{ id: "saved-page", savedAt: 123, url, title: "My title", titleEdited: true,
      description: "Notes", projectId: "local-project" }] }), url);
  await page.goto(new URL("settings.html#backup", extension.url).href);
  const panel = page.getByRole("region", { name: regionName });
  await panel.getByRole("textbox", { name: "Empty local WebDAV directory" }).fill(endpoint);
  return panel;
}

const readMeta = page => page.evaluate(async () => (await chrome.storage.local.get("laterOnSyncMeta")).laterOnSyncMeta);
const openSettings = (context, extensionUrl) => context.newPage().then(async page => {
  await page.goto(new URL("settings.html#backup", extensionUrl).href);
  return page;
});
const syncPanel = page => page.getByRole("region", { name: regionName });

async function previewJoin(panel, endpoint, collectionId) {
  await panel.getByRole("textbox", { name: "Existing local WebDAV directory" }).fill(endpoint);
  await panel.getByRole("textbox", { name: "Expected library ID" }).fill(collectionId);
  await panel.getByRole("button", { name: "Preview join" }).click();
}

async function rejoin(page, endpoint, binding) {
  const panel = syncPanel(page);
  await panel.getByRole("button", { name: "Unbind" }).click();
  await previewJoin(panel, endpoint, binding.collectionId);
  await panel.getByRole("button", { name: "Confirm join" }).click();
  await expect.poll(async () => (await readMeta(page))?.binding?.bindingId).not.toBe(binding.bindingId);
  await expect(panel.getByRole("button", { name: "Sync now" })).toBeEnabled();
}

test("加入前核对并取消，非空配置确认后备份，并交换原始新增成员", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    await first.getByRole("button", { name: "Create sync library" }).click();
    await first.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(first.getByRole("status")).toHaveText("First snapshot verified.");
    const { binding: { collectionId } } = await readMeta(page);
    const profile = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`] });
    try {
      const worker = profile.serviceWorkers()[0] || await profile.waitForEvent("serviceworker");
      const secondPage = await profile.newPage();
      const local = { id: "other-page", savedAt: 234, url: new URL("article", endpoint).href, title: "Other title", status: "reading",
        image: "local://other-page", imageEdited: true };
      const neighbor = { id: "neighbor-page", savedAt: 345, url: new URL("neighbor", endpoint).href, title: "Neighbor", status: "unread" };
      await worker.evaluate(({ local, neighbor, coverImage }) => chrome.storage.local.set({ laterOnOnboardingSeen: true,
        laterOnSettings: { language: "en", defaultSort: "custom", askFolderOnSingle: false }, laterOnItems: [local, neighbor],
        laterOnActiveProject: "unfiled", laterOnFilter: "all", laterOnFilterChosen: true,
        laterOnCovers: { [local.id]: coverImage }, laterOnReadingPositions: { [local.id]: 0 },
        laterOnOrder: { all: [neighbor.id, local.id], unfiled: [local.id, neighbor.id] }
      }), { local, neighbor, coverImage });
      await secondPage.goto(new URL("settings.html#backup", worker.url()).href);
      const second = secondPage.getByRole("region", { name: regionName });
      const join = second.getByRole("button", { name: "Preview join" });
      const identity = second.getByRole("textbox", { name: "Expected library ID" });
      const read = () => secondPage.evaluate(() => chrome.storage.local.get(["laterOnItems", "laterOnReadingPositions", "laterOnPreRestoreBackup"]));
      const puts = () => dav.requests.filter(({ method }) => method === "PUT").length;
      await second.getByRole("textbox", { name: "Existing local WebDAV directory" }).fill(endpoint);
      await identity.fill("00000000-0000-0000-0000-000000000000");
      await join.click();
      await expect(second.getByRole("alert")).toBeVisible();
      expect(await readMeta(secondPage)).toBeUndefined();
      await identity.fill(collectionId);
      dav.corruptSnapshot = true;
      await join.click();
      await expect(second.getByRole("alert")).toBeVisible();
      expect(await readMeta(secondPage)).toBeUndefined();
      dav.corruptSnapshot = false;
      await join.click();
      await second.getByRole("button", { name: "Cancel preview" }).click();
      expect((await read()).laterOnItems).toEqual([local, neighbor]);
      expect(puts()).toBe(2);
      await join.click();
      await second.getByRole("button", { name: "Confirm join" }).click();
      await expect(second.getByRole("status")).toHaveText("Joined. Use Sync now to exchange collection changes.");
      const joined = await read();
      expect(joined.laterOnItems.map(item => item.id)).toEqual([local.id, neighbor.id, "saved-page"]);
      expect(joined.laterOnReadingPositions).toEqual({ [local.id]: 0 });
      expect(joined.laterOnPreRestoreBackup.data.items.map(item => item.id)).toEqual([local.id, neighbor.id]);
      expect(joined.laterOnPreRestoreBackup.data.covers).toEqual({ [local.id]: coverImage });
      expect(puts()).toBe(2);
      const library = await profile.newPage();
      await library.goto(new URL("library.html?from=sidepanel&project=unfiled&filter=all", worker.url()).href);
      const sidepanel = await profile.newPage();
      await sidepanel.goto(new URL("sidepanel.html", worker.url()).href);
      for (const [view, cards, cover] of [[library, "#cardGrid .card", ".cover-img"], [sidepanel, "#items .item", ".thumb-img"]]) {
        await expect.poll(() => view.locator(cards).evaluateAll(elements => elements.map(element => element.dataset.id)))
          .toEqual(["saved-page", neighbor.id]);
        await expect(view.locator(`${cards}[data-id="saved-page"] ${cover}`)).toHaveAttribute("src", coverImage);
      }
      const order = await library.evaluate(async () => (await chrome.storage.local.get("laterOnOrder")).laterOnOrder);
      expect(order).toEqual({ all: [neighbor.id, local.id], unfiled: [local.id, neighbor.id] });
      await library.locator('#cardGrid [data-id="saved-page"] .edit').press("Enter");
      const edit = library.getByRole("dialog").filter({ has: library.getByRole("heading", { name: "Edit page" }) });
      await edit.getByRole("button", { name: "Remove cover" }).click();
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => library.evaluate(async () => (await chrome.storage.local.get("laterOnCovers")).laterOnCovers)).toEqual({});
      await expect(library.locator('#cardGrid [data-id="saved-page"] .cover-img')).toHaveCount(0);
      const article = await profile.newPage();
      await article.goto(local.url);
      await expect(async () => {
        await article.evaluate(() => { window.scrollTo(0, 640); window.dispatchEvent(new Event("scroll")); });
        expect((await read()).laterOnReadingPositions).toEqual({ [local.id]: 640 });
      }).toPass({ timeout: 5000, intervals: [700] });
      dav.offline = true;
      await article.goto(new URL("offline-addition", endpoint).href);
      await expect(sidepanel.locator("#saveCurrent")).toBeEnabled();
      await sidepanel.locator("#saveCurrent").click();
      await expect.poll(async () => (await read()).laterOnItems.length).toBe(4);
      const offline = (await read()).laterOnItems.find(item => item.url.endsWith("/offline-addition"));
      expect(puts()).toBe(2);
      await second.getByRole("button", { name: "Sync now" }).click();
      await expect(second.getByRole("alert")).toBeVisible();
      expect((await read()).laterOnItems.some(item => item.id === offline.id)).toBe(true);
      dav.offline = false;
      await second.getByRole("button", { name: "Sync now" }).click();
      await expect(second.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
      await first.getByRole("button", { name: "Sync now" }).click();
      await expect(first.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
      const items = await page.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems);
      expect(items.map(item => item.id).sort()).toEqual(["saved-page", local.id, neighbor.id, offline.id].sort());
      expect(items.find(item => item.id === local.id).status).not.toBe("reading");
    } finally { await profile.close(); }
  });
});

test("双配置通过编辑框分别改标题和摘要，再同步显式清空", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    const duplicateUrl = new URL("offline-addition", endpoint).href;
    await page.evaluate(async duplicateUrl => {
      const { laterOnItems } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnFilter: "all", laterOnFilterChosen: true,
        laterOnItems: [...laterOnItems.map(item => ({ ...item, projectId: null })),
          { id: "zz-auto-page", url: duplicateUrl, savedAt: 124, title: duplicateUrl }] });
    }, duplicateUrl);
    await first.getByRole("button", { name: "Create sync library" }).click();
    await first.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(first.getByRole("status")).toHaveText("First snapshot verified.");
    const root = path.resolve(tmpdir());
    const profileDir = await mkdtemp(path.join(root, "stayside-sync-text-test-"));
    const launch = () => chromium.launchPersistentContext(profileDir, { channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`] });
    let profile;
    try {
      profile = await launch();
      const worker = profile.serviceWorkers()[0] || await profile.waitForEvent("serviceworker");
      await worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" }, laterOnOnboardingSeen: true }));
      const secondPage = await openSettings(profile, worker.url());
      const second = syncPanel(secondPage);
      await previewJoin(second, endpoint, (await readMeta(page)).binding.collectionId);
      await second.getByRole("button", { name: "Confirm join" }).click();
      const library = async (profile, url) => {
        const view = await profile.newPage();
        await view.goto(new URL("library.html?from=sidepanel&project=unfiled&filter=all", url).href);
        return view;
      };
      const left = await library(context, extension.url), right = await library(profile, worker.url());
      const openEdit = async (view, id = "saved-page") => {
        await view.locator(`#cardGrid [data-id="${id}"] .edit`).press("Enter");
        return view.getByRole("dialog").filter({ has: view.getByRole("heading", { name: "Edit page" }) });
      };
      const save = dialog => dialog.getByRole("button", { name: "Save", exact: true }).click();
      const title = dialog => dialog.getByRole("textbox", { name: "Title", exact: true });
      const summary = dialog => dialog.getByRole("textbox", { name: "Summary", exact: true });
      const sync = async panel => {
        await panel.getByRole("button", { name: "Sync now" }).click();
        await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
        await expect(panel.getByRole("alert")).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Sync now" })).toBeEnabled();
      };
      const repeatSave = name => page.evaluate(({ url, title }) => chrome.runtime.sendMessage({ type: "SAVE_ITEM", item: { url, title } }),
        { url: duplicateUrl, title: name });
      const autoSeed = (await readMeta(page)).binding.state.members.find(member => member.id === "zz-auto-page");
      dav.offline = true;
      expect(await repeatSave("Auto title from duplicate capture")).toMatchObject({ duplicated: true, refreshed: true });
      expect((await readMeta(page)).binding.state.members.find(member => member.id === "zz-auto-page")).toEqual(autoSeed);
      const manual = await openEdit(right, "zz-auto-page");
      await title(manual).fill("Manually named article");
      await save(manual);
      await expect.poll(async () => (await readMeta(secondPage)).binding.state.members.find(member => member.id === "zz-auto-page").title.value)
        .toBe("Manually named article");
      dav.offline = false;
      const firstEdit = await openEdit(left), secondEdit = await openEdit(right);
      await title(firstEdit).fill("Left title");
      await save(firstEdit);
      await expect.poll(async () => (await readMeta(page)).binding.state.members[0].title.value).toBe("Left title");
      await summary(secondEdit).fill("Right notes");
      await save(secondEdit);
      await expect.poll(async () => (await readMeta(secondPage)).binding.state.members[0].description.value).toBe("Right notes");
      await sync(first);
      await sync(second);
      await sync(first);
      await expect(left.locator('#cardGrid [data-id="saved-page"]')).toContainText("Right notes");
      await expect(right.locator('#cardGrid [data-id="saved-page"]')).toContainText("Left title");
      await expect(left.locator('#cardGrid [data-id="zz-auto-page"]')).toContainText("Manually named article");
      expect(await repeatSave("Auto title must not replace the remote hand edit")).toMatchObject({ duplicated: true, refreshed: false });
      const secondHead = `${folder}head-${(await readMeta(secondPage)).deviceId}.json`;
      const earlierIndex = dav.files.get(secondHead);
      const stale = await openEdit(left);
      await title(stale).fill("Stale title draft");
      await summary(stale).fill("");
      const remoteEdit = await openEdit(right);
      await title(remoteEdit).fill("Replacement title");
      await save(remoteEdit);
      await expect.poll(async () => (await readMeta(secondPage)).binding.state.members[0].title.value).toBe("Replacement title");
      await sync(second);
      await sync(first);
      await save(stale);
      await expect.poll(async () => (await readMeta(page)).binding.state.members[0].description.value).toBe("");
      await sync(first);
      await sync(second);
      const check = await openEdit(right);
      await expect(summary(check)).toHaveValue("");
      await expect(title(check)).toHaveValue("Replacement title");
      const recovery = settings => settings.evaluate(async () =>
        (await chrome.storage.local.get("laterOnOverrideLog")).laterOnOverrideLog ?? []);
      expect((await recovery(page)).map(({ kind, value }) => ({ kind, value }))).toEqual([
        { kind: "draft", value: "Stale title draft" }, { kind: "overwritten", value: "Left title" }
      ]);
      expect((await recovery(secondPage)).map(({ kind, value }) => ({ kind, value }))).toEqual([{ kind: "overwritten", value: "Right notes" }]);
      const beforeReplay = await readMeta(page), beforeRecovery = await recovery(page);
      const latestIndex = dav.files.get(secondHead);
      try {
        dav.files.set(secondHead, earlierIndex);
        await first.getByRole("button", { name: "Sync now" }).click();
        await expect(first.getByRole("alert")).toBeVisible();
        expect(await readMeta(page)).toEqual(beforeReplay);
        expect(await recovery(page)).toEqual(beforeRecovery);
      } finally { dav.files.set(secondHead, latestIndex); }
      await sync(first);
      await page.getByRole("button", { name: "View local recovery records" }).click();
      await expect(page.getByText("Stale title draft", { exact: true })).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: "Overwritten local edit" })).toContainText("Left title");
      const persisted = await readMeta(secondPage);
      await profile.close();
      profile = await launch();
      const reopened = await openSettings(profile, worker.url());
      expect(await readMeta(reopened)).toEqual(persisted);
      await sync(syncPanel(reopened));
      const restarted = await openEdit(await library(profile, worker.url()));
      await expect(title(restarted)).toHaveValue("Replacement title");
      await expect(summary(restarted)).toHaveValue("");
      await restarted.getByRole("button", { name: "Cancel" }).click();
      const unpublished = await openEdit(left);
      await title(unpublished).fill("Unpublished local edit");
      await save(unpublished);
      await expect.poll(async () => (await readMeta(page)).binding.state.members[0].title.value).toBe("Unpublished local edit");
      const afterRestart = await openEdit(await library(profile, worker.url()));
      await title(afterRestart).fill("Newer edit after restart");
      await save(afterRestart);
      await expect.poll(async () => (await readMeta(reopened)).binding.state.members[0].title.value).toBe("Newer edit after restart");
      await sync(syncPanel(reopened));
      await sync(first);
      await expect(left.locator('#cardGrid [data-id="saved-page"]')).toContainText("Newer edit after restart");
      expect(await recovery(page)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "overwritten", value: "Unpublished local edit" })]));
    } finally {
      await profile?.close();
      if (path.dirname(profileDir) !== root || !path.basename(profileDir).startsWith("stayside-sync-text-test-")) throw new Error("Unexpected profile path");
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});

test("同步按确认时的原始成员删除，乱序收敛且可主动重收", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    const articleUrl = new URL("article", endpoint).href;
    const delayedUrl = new URL("offline-addition", endpoint).href;
    const groupUrl = new URL("group", endpoint).href;
    const makeItem = (id, savedAt, url, title) => ({ id, savedAt, url, title });
    const seed = (view, data) => view.evaluate(values => chrome.storage.local.set({
      laterOnSettings: { language: "en" }, laterOnOnboardingSeen: true, ...values
    }), data);
    await seed(page, { laterOnItems: [
      { ...makeItem("left-article", 100, articleUrl, "Original title"), titleEdited: true, description: "Original notes", descriptionEdited: true },
      makeItem("left-delayed", 100, delayedUrl, "Left delayed"), makeItem("left-group", 100, groupUrl, "Left group")
    ] });
    await first.getByRole("button", { name: "Create sync library" }).click();
    await first.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(first.getByRole("status")).toHaveText("First snapshot verified.");
    const root = path.resolve(tmpdir());
    const profileDir = await mkdtemp(path.join(root, "stayside-sync-delete-test-"));
    let profile;
    try {
      profile = await chromium.launchPersistentContext(profileDir, { channel: "chromium", headless: true,
        args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`] });
      const worker = profile.serviceWorkers()[0] || await profile.waitForEvent("serviceworker");
      const secondPage = await openSettings(profile, worker.url());
      const second = syncPanel(secondPage);
      await seed(secondPage, { laterOnItems: [
        { ...makeItem("right-article", 200, articleUrl, "Surviving title"), description: "Surviving notes", image: "local://right-article" },
        makeItem("right-delayed", 200, delayedUrl, "Right delayed"), makeItem("right-group", 200, groupUrl, "Right group")
      ], laterOnCovers: { "right-article": coverImage }, laterOnReadingPositions: { "right-article": 480 },
      laterOnOrder: { unfiled: ["right-delayed", "right-article", "right-group"] } });
      await secondPage.reload();
      await previewJoin(second, endpoint, (await readMeta(page)).binding.collectionId);
      await second.getByRole("button", { name: "Confirm join" }).click();
      await expect(second.getByRole("status")).toHaveText("Joined. Use Sync now to exchange collection changes.");
      const library = async (profile, url) => {
        const view = await profile.newPage();
        await view.goto(new URL("library.html?from=sidepanel&project=unfiled&filter=all", url).href);
        return view;
      };
      const left = await library(context, extension.url), right = await library(profile, worker.url());
      await right.locator("#sortSelect").selectOption("custom");
      const sidepanel = await profile.newPage();
      await sidepanel.goto(new URL("sidepanel.html", worker.url()).href);
      const card = (view, id) => view.locator(`#cardGrid [data-id="${id}"]`);
      const sync = async panel => {
        await panel.getByRole("button", { name: "Sync now" }).click();
        await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
        await expect(panel.getByRole("alert")).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Sync now" })).toBeEnabled();
      };
      const openDelete = async (view, target) => {
        await target.locator(".delete").press("Enter");
        return view.getByRole("dialog").getByRole("button", { name: "Delete", exact: true });
      };
      const edit = async (field, value) => {
        await card(right, "left-article").locator(".edit").press("Enter");
        const dialog = right.getByRole("dialog");
        await dialog.getByRole("textbox", { name: field, exact: true }).fill(value);
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await expect(dialog).toBeHidden();
      };
      const state = async view => (await readMeta(view)).binding.state;
      const stored = view => view.evaluate(() => chrome.storage.local.get([
        "laterOnItems", "laterOnCovers", "laterOnReadingPositions", "laterOnOrder", "laterOnOverrideLog"
      ]));
      const cardOrder = () => right.locator("#cardGrid .card").evaluateAll(elements => elements.map(element => element.dataset.id));
      await expect(card(right, "left-article").locator(".cover-img")).toHaveAttribute("src", coverImage);
      await expect.poll(cardOrder).toEqual(["left-delayed", "left-article", "left-group"]);
      const survivor = (await state(secondPage)).members.find(member => member.id === "right-article");
      await edit("Title", "Published on the right");
      await expect.poll(async () => (await state(secondPage)).members.find(member => member.id === "left-article").title.value)
        .toBe("Published on the right");
      await sync(second);
      await edit("Summary", "Unpublished on the right");
      await expect.poll(async () => (await state(secondPage)).members.find(member => member.id === "left-article").description.value)
        .toBe("Unpublished on the right");
      await (await openDelete(left, card(left, "left-article"))).click();
      await expect(card(left, "left-article")).toHaveCount(0);
      expect((await state(page)).deletedIds).toEqual(["left-article"]);
      const delayed = await openDelete(left, card(left, "left-delayed"));
      await expect(delayed).toBeVisible();
      await sync(first);
      await delayed.click();
      await expect(card(left, "right-delayed")).toBeVisible();
      await sync(first);
      await sync(second);
      await expect(card(right, "right-article")).toContainText("Surviving title");
      await expect(card(right, "right-article")).toContainText("Surviving notes");
      await expect(card(right, "right-article").locator(".cover-img")).toHaveAttribute("src", coverImage);
      await expect.poll(cardOrder).toEqual(["right-delayed", "right-article", "left-group"]);
      expect(await stored(secondPage)).toMatchObject({ laterOnReadingPositions: { "right-article": 480 },
        laterOnOrder: { unfiled: ["right-delayed", "right-article", "right-group"] } });
      expect((await state(page)).members.find(member => member.id === survivor.id)).toEqual(survivor);
      expect(await state(page)).toEqual(await state(secondPage));
      expect((await readMeta(page)).binding.confirmed.head.stateHash).toBe((await readMeta(secondPage)).binding.confirmed.head.stateHash);
      const article = await profile.newPage();
      await article.goto(articleUrl);
      const resume = article.getByRole("button", { name: "Continue from last position" });
      await resume.click();
      await expect.poll(() => article.evaluate(() => Math.round(scrollY))).toBe(480);
      await secondPage.getByRole("button", { name: "View local recovery records" }).click();
      for (const value of [/^Published on the right$/, /^Unpublished on the right$/]) {
        await expect(secondPage.getByRole("listitem").filter({ hasText: "Overwritten local edit" })
          .locator(".edit-recovery-value").filter({ hasText: value })).toHaveCount(1);
      }
      expect((await stored(secondPage)).laterOnOverrideLog).toHaveLength(2);
      await sync(first);
      await sync(second);
      expect((await stored(secondPage)).laterOnOverrideLog).toHaveLength(2);
      const stale = await openDelete(left, card(left, "right-delayed"));
      await expect(stale).toBeVisible();
      await right.locator("#selectMode").click();
      const selectGroup = card(right, "left-group").locator(".select-check");
      await selectGroup.press("Space");
      await expect(selectGroup).toBeChecked();
      await right.locator("#bulkDelete").click();
      await right.getByRole("dialog").getByRole("button", { name: "Delete 1", exact: true }).click();
      await expect(card(right, "left-group")).toHaveCount(0);
      await expect(right.getByText("Finished deleting selected pages")).toBeVisible();
      expect((await state(secondPage)).deletedIds).toEqual(["left-article", "left-delayed", "left-group", "right-group"]);
      await (await openDelete(sidepanel, sidepanel.locator('#items [data-id="right-article"]'))).click();
      await expect(sidepanel.locator('#items [data-id="right-article"]')).toHaveCount(0);
      await sync(second);
      const leftBinding = (await readMeta(page)).binding;
      await first.getByRole("button", { name: "Unbind" }).click();
      await previewJoin(first, endpoint, leftBinding.collectionId);
      await expect(first.getByText(/remove 3 local items/)).toBeVisible();
      await first.getByRole("button", { name: "Cancel preview" }).click();
      await expect(card(left, "right-article")).toBeVisible();
      await previewJoin(first, endpoint, leftBinding.collectionId);
      await first.getByRole("button", { name: "Confirm join" }).click();
      await expect(first.getByRole("button", { name: "Sync now" })).toBeEnabled();
      expect((await readMeta(page)).binding.bindingId).not.toBe(leftBinding.bindingId);
      await expect(card(left, "right-article")).toHaveCount(0);
      await stale.click();
      await expect(left.getByText("Something went wrong. Try again.")).toBeVisible();
      await expect(card(left, "right-delayed")).toBeVisible();
      await article.bringToFront();
      await sidepanel.locator("#saveCurrent").click();
      await expect.poll(async () => (await stored(secondPage)).laterOnItems.some(item => item.url === articleUrl)).toBe(true);
      const collected = (await stored(secondPage)).laterOnItems.find(item => item.url === articleUrl);
      expect(["left-article", "right-article"]).not.toContain(collected.id);
      await sync(second);
      await sync(first);
      await expect(card(left, collected.id)).toBeVisible();
      expect(await state(page)).toEqual(await state(secondPage));
      expect((await state(page)).deletedIds).toContain("right-article");
    } finally {
      try { await profile?.close(); }
      finally { if (path.dirname(profileDir) === root && path.basename(profileDir).startsWith("stayside-sync-delete-test-")) await rm(profileDir, { recursive: true, force: true }); }
    }
  });
});

test("同库重绑挡住旧下载和未发送索引，清空或覆盖恢复不写服务端", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const panel = await openPanel(page, extension, endpoint);
    await panel.getByRole("button", { name: "Create sync library" }).click();
    await panel.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(panel.getByRole("status")).toHaveText("First snapshot verified.");
    const settings = await openSettings(context, extension.url);
    const first = await readMeta(page);
    const downloads = Promise.withResolvers();
    const releaseDownload = Promise.withResolvers();
    dav.beforeGet = async url => {
      if (!url.endsWith(".gz")) return;
      dav.beforeGet = undefined;
      downloads.resolve();
      await releaseDownload.promise;
    };
    await panel.getByRole("button", { name: "Sync now" }).click();
    try {
      await downloads.promise;
      await rejoin(settings, endpoint, first.binding);
    } finally { releaseDownload.resolve(); }
    const rebound = await readMeta(settings);
    expect(rebound.binding.collectionId).toBe(first.binding.collectionId);
    expect(rebound.binding.bindingId).not.toBe(first.binding.bindingId);
    await expect(panel.getByRole("alert")).toBeVisible();
    expect(await readMeta(page)).toEqual(rebound);

    const saved = await settings.evaluate(url => chrome.runtime.sendMessage({ type: "SAVE_ITEM", item: { url, title: "Local addition" } }),
      new URL("queued", endpoint).href);
    expect(saved.ok).toBe(true);
    const prepared = Promise.withResolvers();
    const releasePut = Promise.withResolvers();
    dav.beforePut = async url => {
      if (!url.endsWith(".gz")) return;
      dav.beforePut = undefined;
      prepared.resolve();
      await releasePut.promise;
    };
    await panel.getByRole("button", { name: "Sync now" }).click();
    try {
      await prepared.promise;
      await rejoin(settings, endpoint, rebound.binding);
    } finally { releasePut.resolve(); }
    await expect(panel.getByRole("alert")).toBeVisible();
    const headWrites = dav.requests.filter(({ method, url }) => method === "PUT" && url.endsWith(".json"));
    expect(headWrites).toHaveLength(1);
    expect((await readMeta(settings)).binding.pending).toBeUndefined();
    const count = dav.requests.length;

    await settings.goto(new URL("settings.html#data", extension.url).href);
    await settings.getByRole("button", { name: "Clear", exact: true }).click();
    await settings.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect.poll(async () => (await readMeta(settings)).binding).toBeUndefined();
    expect(await settings.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems)).toEqual([]);
    expect(dav.requests).toHaveLength(count);
    const restore = await openSettings(context, extension.url);
    await previewJoin(syncPanel(restore), endpoint, first.binding.collectionId);
    await syncPanel(restore).getByRole("button", { name: "Confirm join" }).click();
    await expect(syncPanel(restore).getByRole("button", { name: "Sync now" })).toBeEnabled();
    const afterJoin = dav.requests.length;
    const replaced = await restore.evaluate(async () => {
      const exported = await chrome.runtime.sendMessage({ type: "BACKUP_EXPORT" });
      const payload = { ...exported.payload, data: { ...exported.payload.data, items: [] } };
      const { token } = await chrome.runtime.sendMessage({ type: "BACKUP_PREVIEW", payload, mode: "replace" });
      return chrome.runtime.sendMessage({ type: "BACKUP_APPLY", payload, token, mode: "replace" });
    });
    expect(replaced.ok).toBe(true);
    await expect(syncPanel(restore).getByRole("button", { name: "Create sync library" })).toBeEnabled();
    expect((await readMeta(restore)).binding).toBeUndefined();
    expect(dav.requests).toHaveLength(afterJoin);
  });
});

test("设置页拒绝不完整清单，按顺序发布并回读快照", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    const panel = await openPanel(page, extension, endpoint);
    const create = panel.getByRole("button", { name: "Create sync library" });
    await create.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    expect(await readMeta(page)).toBeUndefined();
    dav.listing = listing;
    await create.click();
    const publish = panel.getByRole("button", { name: "Publish first snapshot" });
    await expect(publish).toBeEnabled();
    const created = await readMeta(page);
    expect(created.binding.collectionId).not.toBe(created.binding.bindingId);
    expect(dav.requests.map(request => request.method)).toEqual(["PROPFIND", "PROPFIND"]);
    const dispatched = [];
    dav.beforePut = async () => { dispatched.push(await readMeta(page)); };
    await publish.click();
    await expect(panel.getByRole("status")).toHaveText("First snapshot verified.");
    const pending = dispatched[0].binding.pending;
    expect(dispatched.map(meta => meta.allocatedSeq)).toEqual([1, 1]);
    expect(pending.head).toMatchObject({ seq: 1, collectionId: created.binding.collectionId, deviceId: created.deviceId });
    expect(pending.baseVersion).toBeTruthy();
    expect(JSON.stringify(pending)).not.toContain("My title");
    const headPath = `${folder}head-${created.deviceId}.json`, snapshotPath = folder + pending.head.snapshotName;
    expect(dav.requests.filter(({ method }) => method !== "PROPFIND").map(({ method, url }) => [method, url])).toEqual([
      ["PUT", snapshotPath], ["PUT", headPath], ["GET", headPath], ["GET", snapshotPath]
    ]);
    expect(dav.requests.filter(({ method }) => method === "PUT").map(({ headers }) => headers["content-type"]))
      .toEqual(["application/gzip", "application/json"]);
    expect(dav.requests.every(({ headers }) => !headers["if-match"] && !headers["if-none-match"])).toBe(true);
    expect(JSON.parse(dav.files.get(headPath))).toEqual(pending.head);
    const snapshot = JSON.parse(gunzipSync(dav.files.get(snapshotPath)));
    expect(snapshot.state.members[0].title.value).toBe("My title");
    expect(JSON.stringify(snapshot)).not.toContain("local-project");
    await page.reload();
    await expect(panel.getByRole("status")).toHaveText("First snapshot verified.");
    expect((await readMeta(page)).deviceId).toBe(created.deviceId);
    expect((await readMeta(page)).binding.pending).toBeUndefined();
  });
});

test("快照摘要不符时不确认，重启仍保留原设备与已分配代次", async () => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.listing = listing;
    dav.corruptSnapshot = true;
    const root = path.resolve(tmpdir());
    const profile = await mkdtemp(path.join(root, "stayside-sync-create-"));
    const launch = () => chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`] });
    let context;
    try {
      context = await launch();
      const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
      const url = new URL("settings.html#backup", worker.url()).href;
      const page = await context.newPage();
      const panel = await openPanel(page, { worker, url }, endpoint);
      await panel.getByRole("button", { name: "Create sync library" }).click();
      await panel.getByRole("button", { name: "Publish first snapshot" }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
      const pending = await readMeta(page);
      expect(pending.binding.pending.head.seq).toBe(pending.allocatedSeq);
      expect(pending.binding.confirmed).toBeUndefined();
      const count = dav.requests.length;
      await context.close();
      context = await launch();
      const reopened = await context.newPage();
      await reopened.goto(url);
      const reopenedPanel = reopened.getByRole("region", { name: regionName });
      await expect(reopenedPanel.getByRole("status")).toHaveText("Publication is not verified. No automatic retry.");
      await expect(reopenedPanel.getByRole("button", { name: "Publish first snapshot" })).toBeDisabled();
      expect(await readMeta(reopened)).toEqual(pending);
      expect(dav.requests).toHaveLength(count);
    } finally {
      await context?.close();
      if (path.dirname(profile) !== root || !path.basename(profile).startsWith("stayside-sync-create-")) throw new Error("Unexpected profile path");
      await rm(profile, { recursive: true, force: true });
    }
  });
});
