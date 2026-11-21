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
const listing = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${folder}</d:href><d:propstat>
<d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status>
</d:propstat></d:response></d:multistatus>`;

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
    dav.requests.push({ method, url, headers });
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (method === "PROPFIND") response.writeHead(207).end(dav.listing);
    else if (method === "PUT") {
      await dav.beforePut?.();
      dav.files.set(url, Buffer.concat(chunks));
      response.writeHead(201).end();
    } else if (method === "GET") {
      const bytes = dav.files.get(url);
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
