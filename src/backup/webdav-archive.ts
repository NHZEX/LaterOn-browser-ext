import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-custom.js";
import type { FileEntry } from "@zip.js/zip.js/lib/zip-core-custom.js";
import { isRecord } from "../storage/contracts";
import { FORMAT, MAX_BYTES, VERSION, counts as countBackupData, parseArchiveData } from "./core";
import type { BackupDocument } from "./core";
import { checkRestoredBackupSize, extractImages, isImageAttachment, isImageAttachmentReference, restoreImages } from "./archive-images";
import type { BackupImageDamage } from "./archive-images";

const BACKUP_ENTRY_NAME = "backup.json";
const MANIFEST_ENTRY_NAME = "manifest.json";
export const ARCHIVE_VERSION = 2;
// MV3 has native compression streams in both the background and the settings page.
const zipOptions = { useWebWorkers: false, useCompressionStream: true };
export const MAX_ARCHIVE_BYTES = MAX_BYTES + 256 * 1024;

export interface ReadBackupArchive {
  readonly payload: BackupDocument;
  readonly imageDamage?: BackupImageDamage;
}

export async function createBackupArchive(backup: BackupDocument, includeImages: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  if (encoder.encode(JSON.stringify(backup)).byteLength > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const { data, images } = await extractImages(backup.data);
  checkRestoredBackupSize({ ...backup, data }, images);
  const json = encoder.encode(JSON.stringify({ ...backup, version: ARCHIVE_VERSION, data }));
  const { appVersion, exportedAt } = backup;
  const manifest = encoder.encode(JSON.stringify({
    version: ARCHIVE_VERSION,
    backup: { file: BACKUP_ENTRY_NAME, format: backup.format, version: ARCHIVE_VERSION },
    appVersion,
    exportedAt,
    counts: countBackupData(backup.data),
    includeImages
  }));
  let unpackedBytes = manifest.byteLength + json.byteLength;
  for (const bytes of images.values()) unpackedBytes += bytes.byteLength;
  if (unpackedBytes > MAX_ARCHIVE_BYTES) throw new Error("BACKUP_TOO_LARGE");

  const lastModDate = new Date(exportedAt);
  const writer = new ZipWriter(new Uint8ArrayWriter(), zipOptions);
  await writer.add(MANIFEST_ENTRY_NAME, new Uint8ArrayReader(manifest), { level: 0, lastModDate });
  await writer.add(BACKUP_ENTRY_NAME, new Uint8ArrayReader(json), { lastModDate });
  for (const [path, bytes] of images) await writer.add(path, new Uint8ArrayReader(bytes), { lastModDate });
  const archive = await writer.close();
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("BACKUP_TOO_LARGE");
  return archive;
}

function createEntryReader(): (entry: FileEntry) => Promise<Uint8Array<ArrayBuffer>> {
  let remaining = MAX_ARCHIVE_BYTES;
  return async entry => {
    if (entry.uncompressedSize > remaining) throw new Error("BACKUP_TOO_LARGE");
    const chunks: Uint8Array[] = [];
    let size = 0;
    await entry.getData(new WritableStream<Uint8Array>({
      write(chunk) {
        remaining -= chunk.byteLength;
        if (remaining < 0) throw new Error("BACKUP_TOO_LARGE");
        size += chunk.byteLength;
        chunks.push(chunk);
      }
    }), { checkCrc32: true });
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
}

const jsonFrom = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const tooLarge = (error: unknown) => error instanceof Error && error.message === "BACKUP_TOO_LARGE";

function checkManifest(manifest: unknown): void {
  if (!isRecord(manifest) || !Number.isInteger(manifest.version)) throw new Error("WEBDAV_INVALID_BACKUP");
  if (manifest.version !== ARCHIVE_VERSION) throw new Error("UNSUPPORTED_BACKUP");
  const { backup } = manifest;
  if (!isRecord(backup) || backup.file !== BACKUP_ENTRY_NAME || backup.format !== FORMAT || backup.version !== ARCHIVE_VERSION) {
    throw new Error("WEBDAV_INVALID_BACKUP");
  }
}

function collectionFromArchive(value: unknown): BackupDocument {
  if (!isRecord(value) || value.format !== FORMAT || value.version !== ARCHIVE_VERSION || typeof value.appVersion !== "string" ||
      typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error("WEBDAV_INVALID_BACKUP");
  return { format: FORMAT, version: VERSION, appVersion: value.appVersion, exportedAt: value.exportedAt,
    data: parseArchiveData(value.data, isImageAttachmentReference) };
}

export async function readBackupArchive(archive: Uint8Array): Promise<ReadBackupArchive> {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const reader = new ZipReader(new Uint8ArrayReader(archive), zipOptions);
  try {
    const entries = new Map<string, FileEntry | null>();
    for await (const entry of reader.getEntriesGenerator()) {
      const name = entry.filename;
      if (entry.directory || (name !== BACKUP_ENTRY_NAME && name !== MANIFEST_ENTRY_NAME && !isImageAttachment(name))) continue;
      entries.set(name, entries.has(name) ? null : entry);
    }
    const backup = entries.get(BACKUP_ENTRY_NAME);
    if (!backup) throw new Error("WEBDAV_INVALID_BACKUP");
    const manifest = entries.get(MANIFEST_ENTRY_NAME);
    if (manifest === undefined) throw new Error("UNSUPPORTED_BACKUP");
    if (!manifest) throw new Error("WEBDAV_INVALID_BACKUP");
    const readEntry = createEntryReader();
    checkManifest(jsonFrom(await readEntry(manifest)));
    const payload = collectionFromArchive(jsonFrom(await readEntry(backup)));
    return await restoreImages(payload, async path => {
      const entry = entries.get(path);
      if (!entry) return null;
      try { return await readEntry(entry); }
      catch (error) {
        if (tooLarge(error)) throw error;
        return null;
      }
    });
  } catch (error) {
    if (tooLarge(error) || (error instanceof Error && error.message === "UNSUPPORTED_BACKUP")) throw error;
    throw new Error("WEBDAV_INVALID_BACKUP");
  } finally {
    await reader.close();
  }
}
