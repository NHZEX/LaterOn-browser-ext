import { MAX_BYTES } from "./core";
import type { BackupData, BackupDocument } from "./core";

const attachmentReference = /^images\/[a-f0-9]{64}\.(png|jpeg|webp|gif)(?:#(png|jpeg|webp|gif))?$/;
const inlineImage = /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=\r\n]+)$/i;

export interface BackupImageDamage {
  readonly attachments: number;
  readonly items: number;
  readonly projects: number;
}

type Images = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
type ReplaceImage = (source: string) => string | null;

export function isImageAttachment(value: unknown): value is string {
  return isImageAttachmentReference(value) && !value.includes("#");
}

export function isImageAttachmentReference(value: unknown): value is string {
  return typeof value === "string" && attachmentReference.test(value);
}

function pathFromReference(reference: string): string {
  const separator = reference.indexOf("#");
  return separator === -1 ? reference : reference.slice(0, separator);
}

function* imageSources(data: BackupData): Iterable<string> {
  yield* Object.values(data.covers);
  for (const { image, favicon } of data.items) {
    if (image) yield image;
    if (favicon) yield favicon;
  }
  for (const { cover } of data.projects) if (cover) yield cover;
}

function replaceImages(data: BackupData, replace: ReplaceImage): BackupData {
  const covers = Object.fromEntries(Object.entries(data.covers).flatMap(([id, source]) => {
    const image = replace(source);
    return image === null ? [] : [[id, image]];
  }));
  return {
    ...data, covers,
    items: data.items.map(item => ({
      ...item,
      ...(item.image === undefined ? {} : {
        image: item.image.startsWith("local://") && !Object.hasOwn(covers, item.id) ? "" : replace(item.image) ?? ""
      }),
      ...(item.favicon === undefined ? {} : { favicon: replace(item.favicon) ?? "" })
    })),
    projects: data.projects.map(project => project.cover === undefined ? project : { ...project, cover: replace(project.cover) ?? "" })
  };
}

async function imageHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function extractImages(data: BackupData): Promise<{ readonly data: BackupData; readonly images: Images }> {
  const pathsByHash = new Map<string, string>();
  const pathsBySource = new Map<string, string>();
  const images = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const source of new Set(imageSources(data))) {
    if (!/^data:image\//i.test(source)) continue;
    const match = inlineImage.exec(source);
    if (!match?.[1] || !match[2]) throw new Error("WEBDAV_INVALID_BACKUP");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset);
    if (!bytes.byteLength) throw new Error("WEBDAV_INVALID_BACKUP");
    const hash = await imageHash(bytes);
    const existing = pathsByHash.get(hash);
    const extension = match[1].toLowerCase();
    const path = existing ?? `images/${hash}.${extension}`;
    if (!existing) {
      pathsByHash.set(hash, path);
      images.set(path, bytes);
    }
    pathsBySource.set(source, path.endsWith(`.${extension}`) ? path : `${path}#${extension}`);
  }
  return { data: replaceImages(data, source => pathsBySource.get(source) ?? source), images };
}

function dataUrlPrefix(reference: string): string {
  const marker = reference.indexOf("#");
  const extension = marker === -1 ? reference.slice(reference.lastIndexOf(".") + 1) : reference.slice(marker + 1);
  return `data:image/${extension};base64,`;
}

export function checkRestoredBackupSize(payload: BackupDocument, images: Images): void {
  let size = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  for (const source of imageSources(payload.data)) {
    const bytes = images.get(pathFromReference(source));
    if (bytes) size += dataUrlPrefix(source).length + Math.ceil(bytes.byteLength / 3) * 4 - source.length;
  }
  if (size > MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
}

function encodeImage(bytes: Uint8Array<ArrayBuffer>): string {
  const parts: string[] = [];
  const chunkSize = 24 * 1024; // Divisible by three, so only the last Base64 chunk can have padding.
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return parts.join("");
}

export async function restoreImages(
  payload: BackupDocument, readImage: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>
): Promise<{ readonly payload: BackupDocument; readonly imageDamage?: BackupImageDamage }> {
  const images = new Map<string, Uint8Array<ArrayBuffer>>();
  const missing = new Set<string>();
  const { data } = payload;
  const paths = new Set<string>();
  for (const source of imageSources(data)) if (isImageAttachmentReference(source)) paths.add(pathFromReference(source));
  for (const path of paths) {
    const bytes = await readImage(path);
    if (!bytes?.byteLength || await imageHash(bytes) !== path.slice("images/".length, path.lastIndexOf("."))) missing.add(path);
    else images.set(path, bytes);
  }

  const isMissing = (source?: string) => source !== undefined && missing.has(pathFromReference(source));
  const dataWithoutMissingImages = missing.size ? replaceImages(data, source => isMissing(source) ? null : source) : data;
  checkRestoredBackupSize({ ...payload, data: dataWithoutMissingImages }, images);
  const encodedImages = new Map(Array.from(images, ([path, bytes]) => [path, encodeImage(bytes)]));
  const restored = { ...payload, data: replaceImages(dataWithoutMissingImages, source => {
    const encoded = encodedImages.get(pathFromReference(source));
    return encoded ? dataUrlPrefix(source) + encoded : source;
  }) };
  if (!missing.size) return { payload: restored };

  const lostCovers = new Set(data.items.filter(({ id, image }) => isMissing(data.covers[id]) || isMissing(image)).map(({ id }) => id));
  return { payload: restored, imageDamage: {
    attachments: missing.size,
    items: data.items.filter(({ id, favicon }) => lostCovers.has(id) || isMissing(favicon)).length,
    projects: data.projects.filter(({ cover, coverPick }) => isMissing(cover) || coverPick?.some(id => lostCovers.has(id))).length
  } };
}
