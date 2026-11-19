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
      laterOnWebdavBackup: { device: sourceId, settings: {
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
    globalThis.fixtureGets = 0;
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
      if (options.method === "PROPFIND") {
        const listing = url.pathname === root ? response(root) + response(folder)
          : response(folder) + response(folder + filename, bytes.length);
        return new Response(`<d:multistatus xmlns:d="DAV:">${listing}</d:multistatus>`, { status: 207 });
      }
      if (options.method === "GET" && url.pathname === folder + filename) {
        globalThis.fixtureGets += 1;
        return new Response(bytes, { headers: { "Content-Length": String(bytes.length) } });
      }
      throw new Error("Unexpected fixture request");
    };
  }, { sourceId, filename, endpoint, directory, compressedFixture });

  await page.goto(new URL("settings.html#data", extension.url).href);
  await page.getByText("WebDAV backups", { exact: true }).click();
  await page.getByRole("button", { name: "Refresh remote backups" }).click();
  await expect(page.getByRole("combobox", { name: "Select remote backup" })).toContainText("This browser profile");
  const databases = () => page.evaluate(async () => (await indexedDB.databases()).map(database => database.name).sort());
  const databasesBeforeDownload = await databases();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup", exact: true }).click()
  ]);
  expect(download.suggestedFilename()).toBe(filename);
  expect((await readFile(await download.path())).equals(archive)).toBe(true);
  expect(await extension.worker.evaluate(() => ({ gets: globalThis.fixtureGets, transfers: globalThis.transferredArchives })))
    .toEqual({ gets: 1, transfers: [{ length: archive.length, remaining: 0 }] });
  expect(await databases()).toEqual(databasesBeforeDownload);
});
