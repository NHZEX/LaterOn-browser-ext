const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
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
    const entry = { method, url, headers, requestBytes: 0, responseBytes: 0, status: null };
    dav.requests.push(entry);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    entry.requestBytes = body.length;
    const reply = (status, data = "", responseHeaders = {}) => {
      entry.status = status;
      entry.responseBytes = Buffer.byteLength(data);
      response.writeHead(status, responseHeaders).end(data);
    };
    if (dav.offline) { reply(503); return; }
    if (method === "PROPFIND") {
      if (dav.listStatus) reply(dav.listStatus);
      else reply(207, dav.discover ? actualListing(dav.files) : dav.listing, dav.listHeaders);
    } else if (method === "PUT") {
      const status = await dav.beforePut?.(url, body);
      if (status) { reply(status); return; }
      dav.files.set(url, body);
      const failure = await dav.afterPut?.(url);
      if (failure === "disconnect") { response.destroy(); return; }
      if (failure === "timeout") return;
      reply(201);
    } else if (method === "GET") {
      const bytes = dav.files.get(url);
      const status = await dav.beforeGet?.(url);
      if (status) { reply(status); return; }
      if (bytes && dav.corruptSnapshot && url.endsWith(".gz")) {
        const snapshot = JSON.parse(gunzipSync(bytes));
        snapshot.state.members[0].title.value = "Different title";
        reply(200, gzipSync(JSON.stringify(snapshot)));
      } else reply(bytes ? 200 : 404, bytes);
    } else if (method === "DELETE") {
      const status = await dav.beforeDelete?.(url);
      reply(status ?? (dav.files.delete(url) ? 204 : 404));
    } else reply(405);
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
const recordPathFor = ({ deviceId, seq, stateHash }) => `${folder}publication-${deviceId}-${seq}-${stateHash}.json`;
const snapshotFileFor = ({ deviceId, seq, stateHash }) => `snapshot-${deviceId}-${seq}-${stateHash}.json.gz`;
const atGeneration = (head, seq) => {
  const key = { ...head, seq };
  return { ...key, snapshotName: snapshotFileFor(key) };
};
const putPathsSince = (dav, count = 0) => dav.requests.slice(count).filter(({ method }) => method === "PUT").map(({ url }) => url);
const requestsSince = (dav, count) => dav.requests.slice(count).map(({ method, url }) => `${method} ${url}`);

const readTraffic = page => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: "WEBDAV_BACKUP", action: "status" })).status.usage);

async function measureTraffic(page, dav, action, { lostPutResponse = false } = {}) {
  const before = await readTraffic(page);
  const start = dav.requests.length;
  await action();
  const after = await readTraffic(page);
  const requests = dav.requests.slice(start);
  const counted = {
    requests: after.requests - before.requests,
    uploaded: after.uploaded - before.uploaded,
    uncertainUploaded: after.uncertainUploaded - before.uncertainUploaded,
    downloaded: after.downloaded - before.downloaded
  };
  const sumBy = (entries, key) => entries.reduce((sum, request) => sum + request[key], 0);
  const accepted = requests.filter(({ status }) => status >= 200 && status < 300);
  const withoutResponse = requests.filter(({ status }) => status === null);
  if (lostPutResponse) {
    expect(withoutResponse.length).toBeGreaterThan(0);
    expect(withoutResponse.every(({ method, url, requestBytes }) =>
      method === "PUT" && url === withoutResponse[0].url && requestBytes === withoutResponse[0].requestBytes)).toBe(true);
  } else expect(withoutResponse).toHaveLength(0);
  const transportRepeats = withoutResponse.slice(1);
  const receivedUploadBytes = sumBy(requests, "requestBytes");
  const acceptedUploadBytes = sumBy(accepted, "requestBytes");
  expect(counted).toEqual({ requests: requests.length - transportRepeats.length,
    uploaded: acceptedUploadBytes, uncertainUploaded: receivedUploadBytes - acceptedUploadBytes - sumBy(transportRepeats, "requestBytes"),
    downloaded: sumBy(requests, "responseBytes") });
  return { ...counted, receivedRequests: requests.length, receivedUploadBytes,
    responses: requests.map(({ method, status }) => [method, status]) };
}

async function syncNow(panel, button = "Sync now") {
  await panel.getByRole("button", { name: button }).click();
  await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
}

async function saveSyncItem(page, endpoint, title) {
  const result = await page.evaluate(item => chrome.runtime.sendMessage({ type: "SAVE_ITEM", item }),
    { url: new URL(title, endpoint).href, title });
  expect(result.ok).toBe(true);
}

async function publishFirst(panel) {
  await panel.getByRole("button", { name: "Create sync library" }).click();
  await panel.getByRole("button", { name: "Publish first snapshot" }).click();
  await expect(panel.getByRole("status")).toHaveText("First snapshot verified.");
}

async function withRestartableProfile(run) {
  const root = path.resolve(tmpdir());
  const profile = await mkdtemp(path.join(root, "stayside-sync-publication-"));
  let context;
  const restart = async () => {
    await context?.close();
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    return { context, worker, url: worker.url() };
  };
  try { await run(restart); }
  finally {
    try { await context?.close(); }
    finally { if (path.dirname(profile) === root && path.basename(profile).startsWith("stayside-sync-publication-")) await rm(profile, { recursive: true, force: true }); }
  }
}

async function editPublishedTitle(context, extensionUrl, title) {
  const view = await context.newPage();
  try {
    await view.goto(new URL("library.html?from=sidepanel&project=unfiled&filter=all", extensionUrl).href);
    await view.locator('#cardGrid [data-id="saved-page"] .edit').press("Enter");
    const dialog = view.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(view.locator('#cardGrid [data-id="saved-page"]')).toContainText(title);
  } finally { await view.close(); }
}

async function makeSeedEditable(page) {
  await page.evaluate(async () => {
    const { laterOnItems } = await chrome.storage.local.get("laterOnItems");
    await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnItems: laterOnItems.map(item => ({ ...item, projectId: null })) });
  });
}

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

test("记录环回 WebDAV 的千条快照、待确认重试和限流流量", async ({ page, extension }, testInfo) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const panel = await openPanel(page, extension, endpoint);
    const items = Array.from({ length: 999 }, (_, index) => {
      const digest = createHash("sha512").update(String(index)).digest("hex");
      return { id: `sample-${index}`, savedAt: 1_000 + index, url: `https://example.test/articles/${digest.slice(0, 24)}`,
        title: `Article ${index} and its source ${digest.slice(24, 48)}`, description: `Reading notes: ${digest.slice(48)}` };
    });
    await page.evaluate(async items => {
      const { laterOnItems } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnItems: [...laterOnItems, ...items] });
    }, items);

    const firstPublication = await measureTraffic(page, dav, () => publishFirst(panel));
    const { binding } = await readMeta(page);
    const snapshot = dav.files.get(folder + binding.confirmed.head.snapshotName);
    const decoded = gunzipSync(snapshot);
    expect(JSON.parse(decoded).state.members).toHaveLength(1_000);

    await saveSyncItem(page, endpoint, "next-article");
    const beforeDisconnect = dav.requests.length;
    dav.afterPut = url => url.endsWith(".gz") ? "disconnect" : undefined;
    const disconnected = await measureTraffic(page, dav, async () => {
      await panel.getByRole("button", { name: "Sync now" }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
    }, { lostPutResponse: true });
    const pending = (await readMeta(page)).binding.pending.head;
    expect(new Set(putPathsSince(dav, beforeDisconnect))).toEqual(new Set([folder + pending.snapshotName]));
    expect(disconnected.uncertainUploaded).toBe(dav.files.get(folder + pending.snapshotName).length);

    dav.afterPut = undefined;
    const beforeRetry = dav.requests.length;
    const retry = await measureTraffic(page, dav, () => syncNow(panel, "Retry publication"));
    expect(putPathsSince(dav, beforeRetry)).toEqual([recordPathFor(pending)]);

    const unchanged = await measureTraffic(page, dav, () => syncNow(panel));
    expect(unchanged.responses).toEqual([["PROPFIND", 207], ["GET", 200]]);

    dav.listStatus = 429;
    const rateLimited = await measureTraffic(page, dav, async () => {
      await panel.getByRole("button", { name: "Sync now" }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
    });
    expect(rateLimited.responses).toEqual([["PROPFIND", 429]]);
    expect((await readMeta(page)).binding.confirmed.head).toEqual(pending);

    await writeFile(testInfo.outputPath("webdav-traffic.json"), JSON.stringify({ fixture: "loopback", members: 1_000,
      snapshotJsonBytes: decoded.length, snapshotGzipBytes: snapshot.length, firstPublication, disconnected, retry, unchanged,
      rateLimited }, null, 2));
  });
});

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
      const secondHead = recordPathFor((await readMeta(secondPage)).binding.confirmed.head);
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
      const secondDevice = (await readMeta(secondPage)).deviceId;
      const peerRecords = [...dav.files].filter(([url]) => url.startsWith(`${folder}publication-${secondDevice}-`));
      try {
        for (const [url] of peerRecords) dav.files.delete(url);
        dav.files.set(secondHead, earlierIndex);
        await first.getByRole("button", { name: "Sync now" }).click();
        await expect(first.getByRole("alert")).toBeVisible();
        expect(await readMeta(page)).toEqual({ ...beforeReplay, binding: { ...beforeReplay.binding, paused: true } });
        expect(await recovery(page)).toEqual(beforeRecovery);
      } finally {
        dav.files.delete(secondHead);
        for (const [url, bytes] of peerRecords) dav.files.set(url, bytes);
      }
      await first.getByRole("button", { name: "Recheck and sync" }).click();
      await expect(first.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
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

test("项目级联删除同步原始成员，同网址成员及本机项目不受影响", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  test.setTimeout(60_000);
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    const project = { id: "local-project", name: "Local project", createdAt: 1 };
    await page.evaluate(async project => {
      const { laterOnItems: [saved] } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnOnboardingSeen: true, laterOnProjects: [project], laterOnItems: [saved,
        { ...saved, id: "outside-project", title: "Keep me", savedAt: 456, projectId: null }] });
    }, project);
    await publishFirst(first);
    const { confirmed: { head: oldHead } } = (await readMeta(page)).binding;
    const oldSnapshot = JSON.parse(gunzipSync(dav.files.get(folder + oldHead.snapshotName)));
    const readLibrary = view => view.evaluate(() => chrome.storage.local.get(["laterOnItems", "laterOnProjects", "laterOnSyncMeta"]));
    await withRestartableProfile(async start => {
      const peer = await start();
      const peerProject = { ...project, name: "Peer’s local project" };
      await peer.worker.evaluate(project => chrome.storage.local.set({ laterOnSettings: { language: "en" },
        laterOnProjects: [project] }), peerProject);
      const secondPage = await openSettings(peer.context, peer.url);
      const second = syncPanel(secondPage);
      await previewJoin(second, endpoint, oldHead.collectionId);
      await second.getByRole("button", { name: "Confirm join" }).click();
      await expect(second.getByRole("status")).toHaveText("Joined. Use Sync now to exchange collection changes.");
      expect((await readLibrary(secondPage)).laterOnItems.map(({ id }) => id).sort()).toEqual(["outside-project", "saved-page"]);

      const library = await context.newPage();
      await library.goto(new URL("library.html?from=sidepanel&project=all&filter=all", extension.url).href);
      const projectRow = library.locator('.project-row[data-id="local-project"]');
      await projectRow.hover();
      await projectRow.locator(".project-more").click();
      await library.locator(".folder-menu").getByText("Delete project", { exact: true }).click();
      await page.evaluate(() => {
        window.projectDeletion = new Promise(resolve => {
          const onDelete = (changes, area) => {
            if (area !== "local" || !changes.laterOnProjects) return;
            chrome.storage.onChanged.removeListener(onDelete);
            resolve({ ids: changes.laterOnItems?.newValue.map(({ id }) => id),
              deletedIds: changes.laterOnSyncMeta?.newValue.binding.state.deletedIds });
          };
          chrome.storage.onChanged.addListener(onDelete);
        });
      });
      await library.locator(".lod-ok").click();
      await expect(projectRow).toHaveCount(0);
      expect(await page.evaluate(() => window.projectDeletion)).toEqual({ ids: ["outside-project"], deletedIds: ["saved-page"] });

      await syncNow(first);
      await syncNow(second);
      const expectPeerSurvivor = async () => {
        const peerLibrary = await readLibrary(secondPage);
        expect(peerLibrary.laterOnItems).toMatchObject([{ id: "outside-project", title: "Keep me" }]);
        expect(peerLibrary.laterOnItems[0].projectId).toBeFalsy();
        expect(peerLibrary.laterOnProjects).toEqual([peerProject]);
        expect(peerLibrary.laterOnSyncMeta.binding.state.deletedIds).toEqual(["saved-page"]);
      };
      await expectPeerSurvivor();

      const replay = { ...oldHead, deviceId: "00000000-0000-4000-8000-000000000099" };
      replay.snapshotName = snapshotFileFor(replay);
      dav.files.set(folder + replay.snapshotName, gzipSync(JSON.stringify({ ...oldSnapshot, deviceId: replay.deviceId })));
      dav.files.set(recordPathFor(replay), Buffer.from(JSON.stringify(replay)));
      const beforeReplay = dav.requests.length;
      await syncNow(second);
      expect(requestsSince(dav, beforeReplay)).toContain(`GET ${folder + replay.snapshotName}`);
      await expectPeerSurvivor();
    });
  });
});

test("首次建库和重绑按实际手写时间逐字段合并", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  test.setTimeout(90_000);
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    await makeSeedEditable(page);
    await page.evaluate(async () => {
      const { laterOnItems } = await chrome.storage.local.get("laterOnItems");
      await chrome.storage.local.set({ laterOnItems: laterOnItems.map(item => ({ ...item, descriptionEdited: true })) });
    });
    const card = view => view.locator('#cardGrid [data-id="saved-page"]');
    const edit = async (profile, url, field, value) => {
      const view = await profile.newPage();
      try {
        await view.goto(new URL("library.html?from=sidepanel&project=unfiled&filter=all", url).href);
        await card(view).locator(".edit").press("Enter");
        const dialog = view.getByRole("dialog");
        await dialog.getByRole("textbox", { name: field, exact: true }).fill(value);
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await expect(dialog).toBeHidden();
      } finally { await view.close(); }
    };
    const join = async (panel, collectionId, status = "Joined. Use Sync now to exchange collection changes.") => {
      await previewJoin(panel, endpoint, collectionId);
      await panel.getByRole("button", { name: "Confirm join" }).click();
      await expect(panel.getByRole("status")).toHaveText(status);
    };
    const member = async settings => (await readMeta(settings)).binding.state.members.find(({ id }) => id === "saved-page");
    const storedText = async settings => (await settings.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems))
      .find(({ id }) => id === "saved-page");

    const firstEditStarted = Date.now();
    await edit(context, extension.url, "Title", "Edited before creating");
    const firstEditDone = Date.now();
    await publishFirst(first);
    const { binding: { collectionId } } = await readMeta(page);
    const initial = await member(page);
    expect(initial.title.revision.wallTime).toBeGreaterThanOrEqual(firstEditStarted);
    expect(initial.title.revision.wallTime).toBeLessThanOrEqual(firstEditDone);
    expect(initial.description).toMatchObject({ manual: true, revision: { wallTime: 0 } });

    await withRestartableProfile(async restart => {
      const peer = await restart();
      await peer.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" }, laterOnOnboardingSeen: true }));
      const secondPage = await openSettings(peer.context, peer.url);
      const second = syncPanel(secondPage);
      await join(second, collectionId);
      await second.getByRole("button", { name: "Unbind" }).click();
      await expect(second.getByRole("button", { name: "Preview join" })).toBeVisible();

      await edit(peer.context, peer.url, "Summary", "Earlier local summary");
      await edit(context, extension.url, "Title", "Older remote title");
      await edit(context, extension.url, "Summary", "Newer remote summary");
      await syncNow(first);
      const remote = await member(page);
      const detachedEditStarted = Date.now();
      await edit(peer.context, peer.url, "Title", "Newer detached title");
      const detachedEditDone = Date.now();
      expect(await storedText(secondPage)).toMatchObject({ title: "Newer detached title", description: "Earlier local summary" });

      const reopened = await restart();
      const settings = await openSettings(reopened.context, reopened.url);
      const panel = syncPanel(settings);
      await join(panel, collectionId);
      const merged = await member(settings);
      expect(merged.title.value).toBe("Newer detached title");
      expect(merged.title.revision.wallTime).toBeGreaterThanOrEqual(detachedEditStarted);
      expect(merged.title.revision.wallTime).toBeLessThanOrEqual(detachedEditDone);
      expect(merged.description).toEqual(remote.description);
      expect(await storedText(settings)).toMatchObject({ title: "Newer detached title", description: "Newer remote summary" });
      await settings.getByRole("button", { name: "View local recovery records" }).click();
      await expect(settings.getByRole("listitem").filter({ hasText: "Overwritten local edit" })).toHaveText(/Earlier local summary/);
      await syncNow(panel);
      await syncNow(first);
      expect(await member(page)).toEqual(merged);

      await panel.getByRole("button", { name: "Unbind" }).click();
      await expect(panel.getByRole("button", { name: "Preview join" })).toBeVisible();
      await edit(reopened.context, reopened.url, "Summary", "");
      await join(panel, collectionId, "First snapshot verified.");
      const cleared = await member(settings);
      expect(cleared.title).toEqual(merged.title);
      expect(cleared.description).toMatchObject({ value: "", manual: true });
      expect(cleared.description.revision.wallTime).toBeGreaterThan(merged.description.revision.wallTime);
      await syncNow(panel);
      await syncNow(first);
      expect(await member(page)).toEqual(cleared);
    });
  });
});

test("同步按确认时的原始成员删除，乱序收敛且可主动重收", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  test.setTimeout(60_000);
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
    await seed(page, { laterOnSyncMeta: { deviceId: "ffffffff-ffff-4fff-8fff-ffffffffffff", allocatedSeq: 0 }, laterOnItems: [
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
      await seed(secondPage, { laterOnSyncMeta: { deviceId: "00000000-0000-4000-8000-000000000000", allocatedSeq: 0 }, laterOnItems: [
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
      expect((await state(page)).members.find(member => member.id === "right-delayed"))
        .toEqual((await state(secondPage)).members.find(member => member.id === "right-delayed"));
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
    await saveSyncItem(page, endpoint, "pending-before-stalled-download");
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
    dav.discover = true;
    dav.beforePut = async () => { dispatched.push(await readMeta(page)); };
    await publish.click();
    await expect(panel.getByRole("status")).toHaveText("First snapshot verified.");
    const pending = dispatched[0].binding.pending;
    expect(dispatched.map(meta => meta.allocatedSeq)).toEqual([1, 1]);
    expect(pending.head).toMatchObject({ seq: 1, collectionId: created.binding.collectionId, deviceId: created.deviceId });
    expect(pending.baseVersion).toBeTruthy();
    expect(JSON.stringify(pending)).not.toContain("My title");
    const headPath = recordPathFor(pending.head), snapshotPath = folder + pending.head.snapshotName;
    expect(dav.requests.filter(({ method }) => method !== "PROPFIND").map(({ method, url }) => [method, url])).toEqual([
      ["PUT", snapshotPath], ["GET", snapshotPath], ["GET", headPath], ["PUT", headPath], ["GET", headPath]
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

test("发布记录写失败后跨重启核验原快照，只补写同一代记录", async () => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    dav.beforePut = url => url.endsWith(".json") ? 503 : undefined;
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
      expect([...dav.files.keys()]).toEqual([folder + pending.binding.pending.head.snapshotName]);
      const count = dav.requests.length;
      await context.close();
      context = await launch();
      const reopened = await context.newPage();
      await reopened.goto(url);
      const reopenedPanel = reopened.getByRole("region", { name: regionName });
      await expect(reopenedPanel.getByRole("status")).toHaveText("Publication is not verified. No automatic retry.");
      expect(await readMeta(reopened)).toEqual(pending);
      expect(dav.requests).toHaveLength(count);
      dav.beforePut = undefined;
      await reopenedPanel.getByRole("button", { name: "Retry publication" }).click();
      await expect(reopenedPanel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
      const confirmed = await readMeta(reopened);
      expect(confirmed.deviceId).toBe(pending.deviceId);
      expect(confirmed.binding.confirmed).toEqual(pending.binding.pending);
      expect(confirmed.binding.pending).toBeUndefined();
      expect(dav.requests.slice(count).filter(({ method }) => method === "PUT").map(({ url }) => url))
        .toEqual([recordPathFor(pending.binding.pending.head)]);
    } finally {
      await context?.close();
      if (path.dirname(profile) !== root || !path.basename(profile).startsWith("stayside-sync-create-")) throw new Error("Unexpected profile path");
      await rm(profile, { recursive: true, force: true });
    }
  });
});

test("快照写入超时可续发，已落盘索引只核验且保留随后手写改动", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  test.setTimeout(75_000);
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const panel = await openPanel(page, extension, endpoint);
    await makeSeedEditable(page);
    await panel.getByRole("button", { name: "Create sync library" }).click();
    dav.afterPut = url => url.endsWith(".gz") ? "timeout" : undefined;
    await panel.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(panel.getByRole("alert")).toBeVisible({ timeout: 32_000 });
    const pending = await readMeta(page);
    const firstRecordPath = recordPathFor(pending.binding.pending.head);
    expect(pending.binding.confirmed).toBeUndefined();
    expect(putPathsSince(dav)).toEqual([folder + pending.binding.pending.head.snapshotName]);
    expect(dav.files.has(putPathsSince(dav)[0])).toBe(true);
    const afterTimeout = dav.requests.length;
    dav.afterPut = undefined;
    await panel.getByRole("button", { name: "Retry publication" }).click();
    await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
    expect(putPathsSince(dav, afterTimeout)).toEqual([firstRecordPath]);

    await editPublishedTitle(context, extension.url, "Title in the pending snapshot");
    const landed = Promise.withResolvers(), disconnect = Promise.withResolvers();
    dav.afterPut = async url => {
      if (!url.endsWith(".json")) return;
      landed.resolve();
      await disconnect.promise;
      return "disconnect";
    };
    await panel.getByRole("button", { name: "Sync now" }).click();
    try {
      await landed.promise;
      await editPublishedTitle(context, extension.url, "Newer local title");
    } finally { disconnect.resolve(); }
    await expect(panel.getByRole("alert")).toBeVisible();
    const uncertain = await readMeta(page);
    const published = uncertain.binding.pending;
    expect(uncertain.binding.confirmed.head.seq).toBe(1);
    expect(JSON.parse(dav.files.get(recordPathFor(published.head)))).toEqual(published.head);
    expect(JSON.parse(gunzipSync(dav.files.get(folder + published.head.snapshotName))).state.members[0].title.value)
      .toBe("Title in the pending snapshot");

    dav.afterPut = undefined;
    dav.corruptSnapshot = true;
    const beforeVerification = dav.requests.length;
    await panel.getByRole("button", { name: "Retry publication" }).click();
    await expect(panel.getByRole("status")).toContainText("Sync paused:");
    expect((await readMeta(page)).binding.confirmed.head.seq).toBe(1);
    expect(putPathsSince(dav, beforeVerification)).toEqual([]);
    dav.corruptSnapshot = false;
    await panel.getByRole("button", { name: "Recheck and sync" }).click();
    await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Newer changes still need to sync.");
    const confirmed = await readMeta(page);
    expect(confirmed.binding.confirmed).toEqual(published);
    expect(confirmed.binding.pending).toBeUndefined();
    expect(confirmed.binding.state.members[0].title.value).toBe("Newer local title");
    expect(putPathsSince(dav, beforeVerification)).toEqual([]);
    await panel.getByRole("button", { name: "Sync now" }).click();
    await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
    const next = (await readMeta(page)).binding.confirmed.head;
    expect(next.seq).toBe(3);
    expect(JSON.parse(gunzipSync(dav.files.get(folder + next.snapshotName))).state.members[0].title.value).toBe("Newer local title");
  });
});

test("未被索引引用的快照缺失或损坏，只能分配新代次", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const panel = await openPanel(page, extension, endpoint);
    await panel.getByRole("button", { name: "Create sync library" }).click();
    dav.beforePut = url => url.endsWith(".json") ? 503 : undefined;
    await panel.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    const first = (await readMeta(page)).binding.pending.head;
    dav.files.delete(folder + first.snapshotName);
    await panel.getByRole("button", { name: "Retry publication" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    const second = (await readMeta(page)).binding.pending.head;
    expect(second.seq).toBe(2);
    const corrupt = Buffer.from("not a gzip snapshot");
    dav.files.set(folder + second.snapshotName, corrupt);
    dav.beforePut = undefined;
    await panel.getByRole("button", { name: "Retry publication" }).click();
    await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
    const confirmed = (await readMeta(page)).binding.confirmed.head;
    expect(confirmed.seq).toBe(3);
    expect(confirmed.stateHash).toBe(first.stateHash);
    expect(dav.files.get(folder + second.snapshotName)).toEqual(corrupt);
    expect(putPathsSince(dav).filter(url => url.endsWith(".gz"))).toEqual([first, second, confirmed].map(head => folder + head.snapshotName));
  });
});

test("逆序列出第 10 和 9 代仍选择第 10 代，不重发过时发布", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const panel = await openPanel(page, extension, endpoint);
    await makeSeedEditable(page);
    await panel.getByRole("button", { name: "Create sync library" }).click();
    await panel.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(panel.getByRole("status")).toHaveText("First snapshot verified.");
    const original = (await readMeta(page)).binding.confirmed.head;
    await editPublishedTitle(context, extension.url, "Unpublished change to keep");
    dav.beforePut = url => url.endsWith(".json") ? 503 : undefined;
    await panel.getByRole("button", { name: "Sync now" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    expect((await readMeta(page)).allocatedSeq).toBe(2);
    const snapshot = JSON.parse(gunzipSync(dav.files.get(folder + original.snapshotName)));
    for (const seq of [10, 9]) {
      const head = atGeneration(original, seq);
      dav.files.set(folder + head.snapshotName, gzipSync(JSON.stringify({ ...snapshot, seq })));
      dav.files.set(recordPathFor(head), Buffer.from(JSON.stringify(head)));
    }
    const beforeRetry = dav.requests.length;
    dav.beforePut = undefined;
    await panel.getByRole("button", { name: "Retry publication" }).click();
    await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
    const { allocatedSeq, binding } = await readMeta(page);
    expect(allocatedSeq).toBe(11);
    expect(binding.confirmed.head.seq).toBe(11);
    expect(putPathsSince(dav, beforeRetry)).toEqual([folder + binding.confirmed.head.snapshotName, recordPathFor(binding.confirmed.head)]);
    const reads = requestsSince(dav, beforeRetry);
    expect(reads).toContain(`GET ${recordPathFor(atGeneration(original, 10))}`);
    expect(reads).not.toContain(`GET ${recordPathFor(atGeneration(original, 9))}`);
    const latest = JSON.parse(gunzipSync(dav.files.get(folder + binding.confirmed.head.snapshotName)));
    expect(latest.state.members[0].title.value).toBe("Unpublished change to keep");
  });
});

test("第 7 代发布晚到后，全新和重启的配置仍接入第 8 代", async ({ page, context, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  test.setTimeout(90_000);
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const original = await openPanel(page, extension, endpoint);
    await original.getByRole("button", { name: "Create sync library" }).click();
    await original.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(original.getByRole("status")).toHaveText("First snapshot verified.");
    const initial = await readMeta(page);
    const recordAt = seq => Array.from(dav.files).find(([url, bytes]) => url.endsWith(".json") && JSON.parse(bytes).seq === seq);
    const save = (settings, title) => settings.evaluate(item => chrome.runtime.sendMessage({ type: "SAVE_ITEM", item }),
      { title, url: new URL(title, endpoint).href });
    const sync = async panel => {
      await panel.getByRole("button", { name: "Sync now" }).click();
      await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
    };
    const join = async (browser, checkPreview) => {
      await browser.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" } }));
      const settings = await openSettings(browser.context, browser.url);
      const panel = syncPanel(settings);
      await previewJoin(panel, endpoint, initial.binding.collectionId);
      await expect(panel.getByRole("button", { name: "Confirm join" })).toBeEnabled();
      await checkPreview?.();
      await panel.getByRole("button", { name: "Confirm join" }).click();
      await expect(panel.getByRole("button", { name: "Sync now" })).toBeEnabled();
      return settings;
    };
    const urls = settings => settings.evaluate(async () => (await chrome.storage.local.get("laterOnItems")).laterOnItems.map(item => item.url));
    for (const seq of [2, 3, 4, 5, 6]) {
      expect((await save(page, `generation-${seq}`)).ok).toBe(true);
      await sync(original);
      expect(recordAt(seq)).toBeDefined();
    }

    const currentPage = await openSettings(context, extension.url);
    const current = syncPanel(currentPage);
    const dispatched = Promise.withResolvers();
    const release = Promise.withResolvers();
    dav.beforePut = async (url, body) => {
      if (!url.endsWith(".json") || JSON.parse(body).seq !== 7) return;
      dispatched.resolve();
      await release.promise;
    };
    const seventhUrl = new URL("generation-7-only", endpoint).href;
    const eighthUrl = new URL("generation-8-only", endpoint).href;
    try {
      expect((await save(page, "generation-7-only")).ok).toBe(true);
      await original.getByRole("button", { name: "Sync now" }).click();
      await dispatched.promise;
      expect((await readMeta(page)).binding.pending.head.seq).toBe(7);
      await rejoin(currentPage, endpoint, initial.binding);
      expect((await readMeta(currentPage)).allocatedSeq).toBe(7);
      expect((await save(currentPage, "generation-8-only")).ok).toBe(true);
      await sync(current);
      const [eighthPath, eighthIndex] = recordAt(8);

      await withRestartableProfile(async restart => {
        const seen = await join(await restart());
        expect(await urls(seen)).toContain(eighthUrl);
        const restarted = await restart();
        const peerPage = await openSettings(restarted.context, restarted.url);
        const peer = syncPanel(peerPage);
        expect((await readMeta(peerPage)).binding.seen).toContainEqual(JSON.parse(eighthIndex));

        release.resolve();
        await expect.poll(() => Boolean(recordAt(7))).toBe(true);
        await expect(original.getByRole("alert")).toBeVisible();
        expect(dav.files.get(eighthPath)).toEqual(eighthIndex);
        expect((await readMeta(currentPage)).binding.confirmed.head.seq).toBe(8);
        await sync(current);
        await sync(peer);
        expect(await urls(currentPage)).toContain(eighthUrl);
        expect(await urls(peerPage)).toContain(eighthUrl);
        await withRestartableProfile(async startFresh => {
          const start = dav.requests.length;
          const fresh = await join(await startFresh(), () => {
            const reads = requestsSince(dav, start);
            expect(reads).toContain(`GET ${eighthPath}`);
            expect(reads).not.toContain(`GET ${recordAt(7)[0]}`);
          });
          expect(await urls(fresh)).toContain(seventhUrl);
          expect(await urls(fresh)).toContain(eighthUrl);
          expect(putPathsSince(dav, start)).toEqual([]);
        });
      });
    } finally { release.resolve(); }
  });
});

test("两套配置收敛后只读取设备索引，不完整清单不能静默短路", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    await publishFirst(first);
    const owner = await readMeta(page);
    await withRestartableProfile(async restart => {
      const peer = await restart();
      await peer.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" } }));
      const peerPage = await openSettings(peer.context, peer.url);
      const second = syncPanel(peerPage);
      await previewJoin(second, endpoint, owner.binding.collectionId);
      await second.getByRole("button", { name: "Confirm join" }).click();
      await expect(second.getByRole("button", { name: "Sync now" })).toBeEnabled();
      await saveSyncItem(peerPage, endpoint, "peer-addition");
      await syncNow(second);
      await syncNow(first);
      await syncNow(second);
      const other = await readMeta(peerPage);
      const firstHead = (await readMeta(page)).binding.confirmed.head;
      const indexes = [recordPathFor(firstHead), recordPathFor(other.binding.confirmed.head)].sort();
      expect((await readMeta(page)).binding.confirmed.head.stateHash).toBe(other.binding.confirmed.head.stateHash);

      for (const panel of [first, second]) {
        const start = dav.requests.length;
        await syncNow(panel);
        expect(requestsSince(dav, start)).toEqual([`PROPFIND ${folder}`, ...indexes.map(url => `GET ${url}`)]);
      }

      const before = (await readMeta(page)).binding.state;
      const limit = Array.from({ length: 749 }, (_, index) => [`${folder}filler-${index}`, null]);
      for (const visible of [new Map([[recordPathFor(firstHead), null]]), new Map(limit)]) {
        dav.discover = false;
        dav.listing = actualListing(visible);
        const start = dav.requests.length;
        await first.getByRole("button", { name: "Sync now" }).click();
        await expect(first.getByRole("alert")).toBeVisible();
        expect((await readMeta(page)).binding.state).toEqual(before);
        expect(dav.requests.slice(start).every(({ method, url }) => method === "PROPFIND" || (method === "GET" && url.endsWith(".json")))).toBe(true);
        dav.discover = true;
        await syncNow(first, "Recheck and sync");
      }
    });
  });
});

test("确认后依次清理旧记录和快照，删除失败可跨重启重试", async () => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    await withRestartableProfile(async restart => {
      const owner = await restart();
      const settings = await owner.context.newPage();
      const panel = await openPanel(settings, owner, endpoint);
      await publishFirst(panel);
      const origin = await readMeta(settings);
      const firstRecord = recordPathFor(origin.binding.confirmed.head);
      const first = folder + origin.binding.confirmed.head.snapshotName;
      const foreign = folder + snapshotFileFor({ deviceId: "00000000-0000-4000-8000-000000000000", seq: 1, stateHash: "f".repeat(64) });
      dav.files.set(foreign, Buffer.from("outside this device's records"));
      await saveSyncItem(settings, endpoint, "publication-two");
      await syncNow(panel);
      const second = folder + (await readMeta(settings)).binding.confirmed.head.snapshotName;
      const checked = Promise.withResolvers(), release = Promise.withResolvers();
      dav.beforeGet = async url => {
        if (!url.endsWith(".json") || !dav.files.has(url) || JSON.parse(dav.files.get(url)).seq !== 3) return;
        checked.resolve();
        await release.promise;
      };
      dav.beforeDelete = url => url === first ? 503 : undefined;
      const start = dav.requests.length;
      await saveSyncItem(settings, endpoint, "publication-three");
      try {
        await panel.getByRole("button", { name: "Sync now" }).click();
        await checked.promise;
        expect(requestsSince(dav, start).filter(request => request.startsWith("DELETE"))).toEqual([]);
        expect(dav.files.has(first)).toBe(true);
        expect(dav.files.has(firstRecord)).toBe(true);
      } finally {
        release.resolve();
      }
      await expect(panel.getByRole("status")).toHaveText("Snapshot verified. Collection changes synced.");
      const thirdHead = (await readMeta(settings)).binding.confirmed.head;
      const third = folder + thirdHead.snapshotName;
      expect(requestsSince(dav, start).filter(request => request.startsWith("DELETE"))).toEqual([`DELETE ${firstRecord}`, `DELETE ${first}`]);
      expect(dav.files.has(firstRecord)).toBe(false);
      expect(dav.files.has(first)).toBe(true);
      await expect(panel.getByRole("alert")).toHaveCount(0);

      const reopened = await restart();
      const reloaded = syncPanel(await openSettings(reopened.context, reopened.url));
      dav.beforeGet = undefined;
      dav.beforeDelete = undefined;
      const retry = dav.requests.length;
      await syncNow(reloaded);
      expect(requestsSince(dav, retry).filter(request => request.startsWith("DELETE"))).toEqual([`DELETE ${firstRecord}`, `DELETE ${first}`]);
      expect(dav.requests.slice(retry).filter(({ method }) => method === "PROPFIND")).toHaveLength(1);
      expect([...dav.files.keys()].filter(url => url.endsWith(".gz")).sort()).toEqual([second, third, foreign].sort());
      const steady = dav.requests.length;
      await syncNow(reloaded);
      expect(requestsSince(dav, steady)).toEqual([`PROPFIND ${folder}`, `GET ${recordPathFor(thirdHead)}`]);
    });
  });
});

for (const missingFile of ["发布记录", "快照"]) test(`读取旧${missingFile}遇 404 时只重新发现一次`, async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    await publishFirst(first);
    const owner = await readMeta(page);
    const oldHead = owner.binding.confirmed.head;
    const oldRecord = recordPathFor(oldHead), oldPath = folder + oldHead.snapshotName;
    await saveSyncItem(page, endpoint, "visible-in-new-snapshot");
    await syncNow(first);
    const newHead = (await readMeta(page)).binding.confirmed.head;
    const newRecord = recordPathFor(newHead), newPath = folder + newHead.snapshotName;
    const newBytes = dav.files.get(newRecord);
    const missingPath = missingFile === "发布记录" ? oldRecord : oldPath;
    dav.files.delete(newRecord);
    dav.beforeGet = url => {
      if (url !== missingPath) return;
      dav.files.set(newRecord, newBytes);
      dav.files.delete(missingPath);
      return 404;
    };

    await withRestartableProfile(async restart => {
      const peer = await restart();
      await peer.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" } }));
      const settings = await openSettings(peer.context, peer.url);
      const panel = syncPanel(settings);
      const start = dav.requests.length;
      await previewJoin(panel, endpoint, owner.binding.collectionId);
      await expect(panel.getByRole("button", { name: "Confirm join" })).toBeVisible();
      expect(requestsSince(dav, start)).toEqual([
        `PROPFIND ${folder}`, `GET ${oldRecord}`, ...(missingPath === oldPath ? [`GET ${oldPath}`] : []),
        `PROPFIND ${folder}`, `GET ${newRecord}`, `GET ${newPath}`
      ]);
      expect(dav.requests.slice(start).filter(({ status }) => status === 404).map(({ url }) => url)).toEqual([missingPath]);
      dav.beforeGet = undefined;
      await panel.getByRole("button", { name: "Confirm join" }).click();
      await expect(panel.getByRole("button", { name: "Sync now" })).toBeEnabled();
      const before = await readMeta(settings);
      expect(before.binding.state.members.map(member => member.title.value)).toContain("visible-in-new-snapshot");

      const third = atGeneration(newHead, 3), fourth = atGeneration(newHead, 4);
      dav.files.set(recordPathFor(third), Buffer.from(JSON.stringify(third)));
      dav.beforeGet = url => {
        if (url === folder + third.snapshotName) dav.files.set(recordPathFor(fourth), Buffer.from(JSON.stringify(fourth)));
      };
      const retry = dav.requests.length;
      await panel.getByRole("button", { name: "Sync now" }).click();
      await expect(panel.getByRole("status")).toContainText("Sync paused:");
      expect(requestsSince(dav, retry)).toEqual([
        `PROPFIND ${folder}`, `GET ${recordPathFor(third)}`, `GET ${folder + third.snapshotName}`,
        `PROPFIND ${folder}`, `GET ${recordPathFor(fourth)}`, `GET ${folder + fourth.snapshotName}`
      ]);
      expect(await readMeta(settings)).toEqual({ ...before, binding: { ...before.binding, paused: true } });
    });
  });
});

test("首次接入拒绝显式分页，不预览半份目录", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    await publishFirst(await openPanel(page, extension, endpoint));
    const { collectionId } = (await readMeta(page)).binding;
    await withRestartableProfile(async start => {
      const peer = await start();
      await peer.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" } }));
      const settings = await openSettings(peer.context, peer.url);
      const panel = syncPanel(settings);
      for (const headers of [{ Link: `<${endpoint}?page=2>; rel="next"` }, { "Content-Range": "items 0-1/4" }]) {
        dav.listHeaders = headers;
        const start = dav.requests.length;
        await previewJoin(panel, endpoint, collectionId);
        await expect(panel.getByRole("alert")).toBeVisible();
        expect(requestsSince(dav, start)).toEqual([`PROPFIND ${folder}`]);
        await expect(panel.getByRole("button", { name: "Confirm join" })).toHaveCount(0);
        expect(await readMeta(settings)).toBeUndefined();
      }
    });
  });
});

test("孤立快照不可接入，混合目录、同代冲突和损坏最高代不降级", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const first = await openPanel(page, extension, endpoint);
    await publishFirst(first);
    const base = (await readMeta(page)).binding.confirmed.head;
    const basePath = recordPathFor(base), baseBytes = dav.files.get(basePath);
    const legacy = `${folder}head-${base.deviceId}.json`;
    const higher = atGeneration(base, 2);
    const duplicate = atGeneration({ ...base, stateHash: "e".repeat(64) }, 1);
    await withRestartableProfile(async start => {
      const peer = await start();
      await peer.worker.evaluate(() => chrome.storage.local.set({ laterOnSettings: { language: "en" } }));
      const settings = await openSettings(peer.context, peer.url);
      const panel = syncPanel(settings);
      for (const records of [[], [[legacy, baseBytes]], [[legacy, baseBytes], [basePath, baseBytes]],
        [[basePath, baseBytes], [recordPathFor(duplicate), Buffer.from(JSON.stringify(duplicate))]],
        [[basePath, baseBytes], [recordPathFor(higher), Buffer.from("invalid JSON")]]]) {
        for (const url of dav.files.keys()) if (url.endsWith(".json")) dav.files.delete(url);
        for (const [url, body] of records) dav.files.set(url, body);
        const before = dav.requests.length;
        await previewJoin(panel, endpoint, base.collectionId);
        await expect(panel.getByRole("alert")).toBeVisible();
        await expect(panel.getByRole("button", { name: "Confirm join" })).toHaveCount(0);
        expect(await readMeta(settings)).toBeUndefined();
        expect(dav.requests.slice(before).filter(({ method }) => method !== "PROPFIND").map(({ method, url }) => [method, url]))
          .toEqual(records.some(([url]) => url === recordPathFor(higher)) ? [["GET", recordPathFor(higher)]] : []);
      }
      await panel.getByRole("textbox", { name: "Empty local WebDAV directory" }).fill(endpoint);
      await panel.getByRole("button", { name: "Create sync library" }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
      expect(await readMeta(settings)).toBeUndefined();
    });
  });
});

test("发布记录能直接读取但目录仍漏列时，发端不报成功", async ({ page, extension }) => {
  test.skip(!acceptance, "Requires sync-acceptance build");
  await withDav(async (dav, endpoint) => {
    dav.discover = true;
    const panel = await openPanel(page, extension, endpoint);
    await panel.getByRole("button", { name: "Create sync library" }).click();
    dav.afterPut = url => {
      if (!url.endsWith(".json")) return;
      dav.discover = false;
      dav.listing = actualListing(new Map([...dav.files].filter(([name]) => name !== url)));
    };
    await panel.getByRole("button", { name: "Publish first snapshot" }).click();
    await expect(panel.getByRole("status")).toContainText("Sync paused:");
    const { binding } = await readMeta(page);
    const record = recordPathFor(binding.pending.head);
    expect(binding.confirmed).toBeUndefined();
    expect(dav.requests.some(({ method, url, status }) => method === "GET" && url === record && status === 200)).toBe(true);
    dav.discover = true;
    const before = dav.requests.length;
    await syncNow(panel, "Recheck and sync");
    expect((await readMeta(page)).binding.confirmed.head).toEqual(binding.pending.head);
    expect(putPathsSince(dav, before)).toEqual([]);
  });
});
