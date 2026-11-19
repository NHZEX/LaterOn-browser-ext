import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-custom.js";
import type { FileEntry } from "@zip.js/zip.js/lib/zip-core-custom.js";
import { MAX_BYTES, counts as countBackupData, parse } from "./core";
import type { BackupDocument } from "./core";

const BACKUP_ENTRY_NAME = "backup.json";
const MANIFEST_ENTRY_NAME = "manifest.json";
// MV3 has native compression streams in both the background and the settings page.
const zipOptions = { useWebWorkers: false, useCompressionStream: true };
export const MAX_ARCHIVE_BYTES = MAX_BYTES + 256 * 1024;

export async function createBackupArchive(backup: BackupDocument, includeImages: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(backup));
  if (json.byteLength > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const { appVersion, exportedAt } = backup;
  const manifest = {
    version: 1,
    backup: { file: BACKUP_ENTRY_NAME, format: backup.format, version: backup.version },
    appVersion,
    exportedAt,
    counts: countBackupData(backup.data),
    includeImages
  };
  const lastModDate = new Date(exportedAt);
  const writer = new ZipWriter(new Uint8ArrayWriter(), zipOptions);
  await writer.add(MANIFEST_ENTRY_NAME, new Uint8ArrayReader(encoder.encode(JSON.stringify(manifest))), { level: 0, lastModDate });
  await writer.add(BACKUP_ENTRY_NAME, new Uint8ArrayReader(json), { lastModDate });
  return writer.close();
}

async function readTextEntry(entry: FileEntry, maxBytes: number): Promise<string> {
  if (entry.uncompressedSize > maxBytes) throw new Error("BACKUP_TOO_LARGE");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const text: string[] = [];
  let size = 0;
  await entry.getData(new WritableStream<Uint8Array>({
    write(chunk) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error("BACKUP_TOO_LARGE");
      text.push(decoder.decode(chunk, { stream: true }));
    }
  }), { checkCrc32: true });
  text.push(decoder.decode());
  return text.join("");
}

export async function readBackupArchive(archive: Uint8Array): Promise<unknown> {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("BACKUP_TOO_LARGE");
  const reader = new ZipReader(new Uint8ArrayReader(archive), zipOptions);
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory || entry.filename !== BACKUP_ENTRY_NAME) continue;
      const payload: unknown = JSON.parse(await readTextEntry(entry, MAX_BYTES));
      parse(payload);
      return payload;
    }
    throw new Error("WEBDAV_INVALID_BACKUP");
  } catch (error) {
    if (error instanceof Error && error.message === "BACKUP_TOO_LARGE") throw error;
    throw new Error("WEBDAV_INVALID_BACKUP");
  } finally {
    await reader.close();
  }
}
