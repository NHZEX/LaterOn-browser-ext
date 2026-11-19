const { readFile } = require("node:fs/promises");
const { zipSync } = require("fflate");
const { test, expect } = require("./extension.cjs");

test("设置页可以通过 MessageChannel 保存约 49 MiB 的原始 WebDAV ZIP", async ({ page, extension }) => {
  const sourceId = "edecf258-a38c-44dc-8c56-222f615c2e3c";
  const filename = "2026-11-19T08-30-00.000Z-manual.zip";
  const endpoint = "https://dav.example.test/dav/";
  const directory = "StaySide";
  const attachmentSize = 49 * 1024 * 1024;
  const backup = { format: "lateron.collection", version: 1, appVersion: "1.79.0", exportedAt: "2026-11-19T08:30:00Z",
    data: { items: [], projects: [], covers: {}, order: {}, readingPositions: {} } };
  const archive = Buffer.from(zipSync({
    "attachment.bin": [new Uint8Array(attachmentSize), { level: 0 }],
    "backup.json": Buffer.from(JSON.stringify(backup))
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
  expect(await extension.worker.evaluate(() => ({ requests: globalThis.fixtureRequests, transfers: globalThis.transferredArchives })))
    .toEqual({ requests: ["PROPFIND", "PROPFIND", "GET"], transfers: [{ length: archive.length, remaining: 0 }] });
  expect(await databases()).toEqual(databasesBeforeDownload);
});
