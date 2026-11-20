const { readFile } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { zipSync } = require("fflate");
const { test, expect } = require("./extension.cjs");

const missingImage = `images/${"a".repeat(64)}.png`;
const archivedItem = { id: "archived", url: "https://example.test/archived", title: "Archived page", savedAt: 1, status: "unread" };
const zipDocuments = data => ({
  "manifest.json": Buffer.from(JSON.stringify({ version: 2, backup: { file: "backup.json", format: "lateron.collection", version: 2 } })),
  "backup.json": Buffer.from(JSON.stringify({ format: "lateron.collection", version: 2, appVersion: "1.79.3", exportedAt: "2026-11-19T08:30:00Z",
    data: { items: [], projects: [], covers: {}, order: {}, readingPositions: {}, ...data } }))
});

test("设置页保存原始 WebDAV ZIP，并将上传超时与重试成功分开显示", async ({ page, extension }) => {
  const sourceId = "edecf258-a38c-44dc-8c56-222f615c2e3c";
  const filename = "2026-11-19T08-30-00.000Z-manual.zip";
  const endpoint = "https://dav.example.test/dav/";
  const directory = "StaySide";
  const attachmentSize = 49 * 1024 * 1024;
  const archive = Buffer.from(zipSync({
    "attachment.bin": [new Uint8Array(attachmentSize), { level: 0 }],
    ...zipDocuments({ items: [{ ...archivedItem, favicon: missingImage }] })
  }));
  // Transfer only the ZIP headers and small JSON to the worker fixture. Recreate the stored zero bytes there.
  const attachmentOffset = 30 + archive.readUInt16LE(26) + archive.readUInt16LE(28);
  const suffixOffset = attachmentOffset + attachmentSize;
  const compressedFixture = {
    length: archive.length, prefix: archive.subarray(0, attachmentOffset).toString("base64"),
    suffixOffset, suffix: archive.subarray(suffixOffset).toString("base64")
  };

  await extension.worker.evaluate(async ({ sourceId, filename, endpoint, directory, compressedFixture }) => {
    await chrome.storage.local.set({
      laterOnCleanupV165: true, laterOnOnboardingSeen: true,
      laterOnSettings: { language: "en", autoCleanEnabled: false },
      laterOnWebdavBackup: { device: sourceId, lastBackup: Date.parse("2026-11-19T08:30:00Z"), settings: {
        endpoint, directory, username: "fixture", password: "fixture",
        automatic: false, includeImages: false, intervalHours: 24, budgetMiB: 192
      } }
    });
    const bytes = new Uint8Array(compressedFixture.length);
    const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
    bytes.set(decode(compressedFixture.prefix));
    bytes.set(decode(compressedFixture.suffix), compressedFixture.suffixOffset);
    const root = new URL(directory + "/backups/", endpoint).pathname;
    const folder = root + sourceId + "/";
    const response = (href, size) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${size === undefined
      ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:getcontentlength>${size}</d:getcontentlength>`
    }</d:prop></d:propstat></d:response>`;
    globalThis.fixtureRequests = [];
    globalThis.fixtureUploadTypes = [];
    globalThis.transferredArchives = [];
    const postMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (reply, transfer) {
      const archive = reply?.archive;
      const length = archive?.byteLength;
      const result = postMessage.apply(this, arguments);
      if (archive instanceof Uint8Array && transfer?.includes(archive.buffer)) {
        globalThis.transferredArchives.push({ length, remaining: archive.buffer.byteLength });
      }
      return result;
    };
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      if (url.origin !== new URL(endpoint).origin) return fetchOriginal(input, options);
      globalThis.fixtureRequests.push(options.method);
      if (options.method === "PROPFIND") {
        const listing = url.pathname === root ? response(root) + response(folder)
          : response(folder) + response(folder + filename, bytes.length);
        return new Response(`<d:multistatus xmlns:d="DAV:">${listing}</d:multistatus>`, { status: 207 });
      }
      if (options.method === "GET" && url.pathname === folder + filename) {
        return new Response(bytes, { headers: { "Content-Length": String(bytes.length) } });
      }
      if (options.method === "PUT") {
        globalThis.fixtureUploadTypes.push(new Headers(options.headers).get("content-type"));
        if (globalThis.fixtureUploadTypes.length === 1) throw new DOMException("Fixture timed out", "TimeoutError");
        return new Response(null, { status: 201 });
      }
      if (options.method === "MOVE") return new Response(null, { status: 201 });
      throw new Error("Unexpected fixture request");
    };
  }, { sourceId, filename, endpoint, directory, compressedFixture });

  await page.goto(new URL("settings.html#backup", extension.url).href);
  const backupCard = page.getByRole("region", { name: "Backup & restore" });
  const webdav = backupCard.getByRole("region", { name: "WebDAV backups" });
  const viewBackups = webdav.getByRole("button", { name: "View backups" });
  const connection = webdav.getByText("Connection settings", { exact: true });
  const address = webdav.getByRole("textbox", { name: "WebDAV address" });
  await expect(backupCard.getByRole("heading", { name: "Local files" })).toBeVisible();
  await expect(webdav.getByText(/^Last backup /)).toBeVisible();
  await expect(webdav.getByRole("button", { name: "Back up now" })).toBeEnabled();
  await expect(viewBackups).toBeEnabled();
  await expect(address).toBeHidden();
  await page.setViewportSize({ width: 400, height: 800 });
  await connection.click();
  await expect(address).toHaveValue(endpoint);
  expect(await backupCard.evaluate(card => card.scrollWidth <= card.clientWidth + 1)).toBe(true);
  await connection.click();
  await expect(address).toBeHidden();
  expect(await extension.worker.evaluate(() => globalThis.fixtureRequests)).toEqual([]);

  await viewBackups.click();
  await expect(webdav.getByRole("button", { name: "Refresh list" })).toBeEnabled();
  await expect(webdav.getByRole("combobox", { name: "Select remote backup" })).toContainText("This browser profile");
  const databases = () => page.evaluate(async () => (await indexedDB.databases()).map(database => database.name).sort());
  const databasesBeforeDownload = await databases();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    webdav.getByRole("button", { name: "Download backup", exact: true }).click()
  ]);
  expect(download.suggestedFilename()).toBe(filename);
  expect((await readFile(await download.path())).equals(archive)).toBe(true);
  await expect(webdav.getByRole("status")).toContainText("Missing or damaged image attachments (1)");
  expect(await extension.worker.evaluate(() => ({ requests: globalThis.fixtureRequests, transfers: globalThis.transferredArchives })))
    .toEqual({ requests: ["PROPFIND", "PROPFIND", "GET"], transfers: [{ length: archive.length, remaining: 0 }] });
  expect(await databases()).toEqual(databasesBeforeDownload);

  const backup = webdav.getByRole("button", { name: "Back up now" });
  const uncertain = webdav.getByText("Unconfirmed uploads: up to 0.01 MiB", { exact: false });
  await expect(uncertain).toHaveCount(0);
  await backup.click();
  await expect(webdav.getByText(/Unable to reach WebDAV/)).toBeVisible();
  await expect(uncertain).toBeVisible();
  await backup.click();
  await expect(webdav.getByText("WebDAV backup uploaded.")).toBeVisible();
  await expect(uncertain).toBeVisible();
  expect(await extension.worker.evaluate(() => globalThis.fixtureUploadTypes)).toEqual(["application/zip", "application/zip"]);
});

test("本地 ZIP 缺图恢复在同一预览确认，取消不写入，覆盖前保留副本", async ({ page, extension }) => {
  await extension.worker.evaluate(() => chrome.storage.local.set({
    laterOnCleanupV165: true, laterOnOnboardingSeen: true,
    laterOnSettings: { language: "en", autoCleanEnabled: false },
    laterOnItems: [{ id: "before", url: "https://example.test/before", savedAt: 1, status: "unread" }]
  }));
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=", "base64");
  const favicon = `images/${createHash("sha256").update(image).digest("hex")}.png`;
  const fixture = Buffer.from(zipSync({
    ...zipDocuments({ items: [{ ...archivedItem, image: "local://archived", favicon, projectId: "project" }],
      projects: [{ id: "project", name: "Project", createdAt: 1, cover: missingImage }], covers: { archived: missingImage } }),
    [favicon]: image
  }));

  await page.goto(new URL("settings.html#backup", extension.url).href);
  await page.getByRole("combobox", { name: "Import mode" }).selectOption("replace");
  const dialog = page.getByRole("dialog");
  const importFile = () => page.locator("#importFile").setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer: fixture });
  const read = keys => extension.worker.evaluate(keys => chrome.storage.local.get(keys), keys);
  await importFile();
  await expect(dialog).toContainText("Missing or damaged image attachments (1). Affected pages (1) and projects (1).");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  const canceled = await read(["laterOnItems", "laterOnPreRestoreBackup"]);
  expect(canceled.laterOnItems[0].id).toBe("before");
  expect(canceled.laterOnPreRestoreBackup).toBeUndefined();

  await importFile();
  await dialog.getByRole("button", { name: "Replace collection without those images" }).click();
  await expect(dialog).toContainText("Restored 1 pages");
  await page.keyboard.press("Escape");
  const after = await read(["laterOnItems", "laterOnCovers", "laterOnIcons", "laterOnProjects", "laterOnPreRestoreBackup"]);
  expect(after.laterOnItems[0]).toMatchObject({ id: "archived", image: "" });
  expect(after.laterOnIcons[after.laterOnItems[0].favicon.slice("icon://".length)]).toBe(`data:image/png;base64,${image.toString("base64")}`);
  expect(after.laterOnCovers).toEqual({});
  expect(after.laterOnProjects[0].cover).toBe("");
  expect(after.laterOnPreRestoreBackup.data.items[0].id).toBe("before");
  await expect(page.getByRole("button", { name: "Download pre-restore local backup" })).toBeVisible();
});
