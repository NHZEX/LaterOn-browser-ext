import { isIconReference, resolveFavicon } from "../storage/icons.ts";
// Portable collection format. No Chrome API, DOM, or implicit clock/randomness.
export interface BackupItem {
  readonly id: string;
  readonly url: string;
  readonly savedAt: number;
  readonly projectId: string | null;
  readonly status: "unread" | "reading" | "done";
  readonly read: boolean;
  readonly doneAt: number | null;
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly favicon?: string;
  readonly source?: string;
  readonly titleEdited?: boolean;
  readonly descriptionEdited?: boolean;
  readonly imageEdited?: boolean;
}

export interface BackupProject {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly note?: string;
  readonly cover?: string;
  readonly coverPick?: readonly string[];
  readonly archived?: boolean;
  readonly pinned?: boolean;
  readonly pinFrom?: number;
}

export interface BackupData {
  readonly items: readonly BackupItem[];
  readonly projects: readonly BackupProject[];
  readonly covers: Readonly<Record<string, string>>;
  readonly order: Readonly<Record<string, readonly string[]>>;
  readonly readingPositions: Readonly<Record<string, number>>;
}

export interface CollectionSnapshot {
  readonly laterOnItems?: readonly unknown[];
  readonly laterOnProjects?: readonly unknown[];
  readonly laterOnCovers?: Readonly<Record<string, unknown>>;
  readonly laterOnIcons?: Readonly<Record<string, string>>;
  readonly laterOnOrder?: Readonly<Record<string, unknown>>;
  readonly laterOnReadingPositions?: Readonly<Record<string, unknown>>;
}

export interface CollectionStorage {
  readonly laterOnItems: BackupData["items"];
  readonly laterOnProjects: BackupData["projects"];
  readonly laterOnCovers: BackupData["covers"];
  readonly laterOnOrder: BackupData["order"];
  readonly laterOnReadingPositions: BackupData["readingPositions"];
}

export interface BackupDocument {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly data: BackupData;
}

export interface BackupCounts {
  readonly items: number;
  readonly projects: number;
  readonly covers: number;
  readonly positions: number;
}

export interface MergeResult {
  readonly data: BackupData;
  readonly added: number;
  readonly duplicates: number;
  readonly addedProjects: number;
}

export const FORMAT = "lateron.collection";
export const VERSION = 1;
export const MAX_BYTES = 50 * 1024 * 1024;

type Guard<T> = (value: unknown) => value is T;
type FieldChecks<T extends object> = { readonly [K in keyof T]-?: Guard<T[K]> };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const isOwnProperty = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
function fail(path: string): never { throw new Error(`INVALID_BACKUP:${path}`); }
const isValidId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200
  && !["__proto__", "prototype", "constructor", "all", "unfiled", "archive"].includes(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isNonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isHttpUrl = (value: unknown): value is string => {
  try { return isString(value) && ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
};
const isImageSource = (value: unknown): value is string => isString(value) && (!value || isHttpUrl(value) || /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value));

// The schema validates each present field before narrowing the selected copy.
// Missing fields remain absent; unknown fields never enter the normalized data.
function validateFields<T extends object>(value: Record<string, unknown>, checks: FieldChecks<T>, path: string): asserts value is Record<string, unknown> & Partial<T> {
  for (const [key, check] of Object.entries<Guard<unknown>>(checks)) {
    if (isOwnProperty(value, key) && !check(value[key])) fail(`${path}.${key}`);
  }
}

function fields<T extends object>(value: unknown, checks: FieldChecks<T>, path: string): Partial<T> {
  if (!isRecord(value)) fail(path);
  const selected = Object.fromEntries(Object.keys(checks).filter((key) => isOwnProperty(value, key)).map((key) => [key, value[key]]));
  validateFields<T>(selected, checks, path);
  return selected;
}

function dictionary<T>(value: unknown, path: string, check: (entry: unknown, key: string) => entry is T): Record<string, T> {
  if (!isRecord(value)) fail(path);
  return Object.fromEntries(Object.entries(value).map(([key, entry]): [string, T] => {
    if (!["all", "unfiled"].includes(key) && !isValidId(key)) fail(`${path}.key`);
    if (!check(entry, key)) fail(`${path}.${key}`);
    return [key, entry];
  }));
}

function uniqueRecords<T extends { readonly id: string }>(entries: unknown, path: string, normalize: (entry: unknown, path: string) => T): T[] {
  if (!isArray(entries)) fail(path);
  const result = entries.map((entry, index) => normalize(entry, `${path}[${index}]`));
  if (new Set(result.map((entry) => entry.id)).size !== result.length) fail(`${path}.duplicateId`);
  return result;
}

function normalizeItem(entry: unknown, path: string): BackupItem {
  if (!isRecord(entry) || !isValidId(entry.id) || !isHttpUrl(entry.url) || !isTimestamp(entry.savedAt)) fail(path);
  const item = fields<BackupItem>(entry, {
    id: isValidId, url: isHttpUrl, title: isString, description: isString,
    image: (value): value is string => isImageSource(value) || (isString(value) && value.startsWith("local://") && isValidId(value.slice(8))),
    favicon: isImageSource, source: isString, projectId: (value): value is string | null => value === null || isValidId(value), savedAt: isTimestamp,
    status: (value): value is BackupItem["status"] => value === "unread" || value === "reading" || value === "done", read: isBoolean,
    doneAt: (value): value is number | null => value === null || isTimestamp(value),
    titleEdited: isBoolean, descriptionEdited: isBoolean, imageEdited: isBoolean
  }, path);
  const status = item.status || (item.read ? "done" : "unread");
  return { ...item, id: entry.id, url: entry.url, savedAt: entry.savedAt, projectId: item.projectId ?? null,
    status, read: status === "done", doneAt: status === "done" ? item.doneAt ?? null : null };
}

function normalizeProject(entry: unknown, path: string): BackupProject {
  if (!isRecord(entry) || !isValidId(entry.id) || !isString(entry.name) || !entry.name.trim() || !isTimestamp(entry.createdAt)) fail(path);
  const project = fields<BackupProject>(entry, {
    id: isValidId, name: isString, createdAt: isTimestamp, note: isString, cover: isImageSource,
    coverPick: (value): value is readonly string[] => isArray(value) && value.length <= 3 && value.every(isValidId) && new Set(value).size === value.length,
    archived: isBoolean, pinned: isBoolean, pinFrom: isNonNegativeInteger
  }, path);
  return { ...project, id: entry.id, name: entry.name, createdAt: entry.createdAt };
}

function validateData(value: unknown): BackupData {
  if (!isRecord(value)) fail("data");
  const items = uniqueRecords(value.items, "items", normalizeItem);
  const projects = uniqueRecords(value.projects, "projects", normalizeProject);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const projectIds = new Set(projects.map((project) => project.id));
  const covers = dictionary(value.covers, "covers", (entry, key): entry is string => itemById.has(key) && isImageSource(entry) && entry.startsWith("data:"));
  const readingPositions = dictionary(value.readingPositions, "readingPositions", (entry, key): entry is number => itemById.has(key) && isNonNegativeInteger(entry));
  const order = dictionary(value.order, "order", (entries, scope): entries is readonly string[] => {
    if (!["all", "unfiled"].includes(scope) && !projectIds.has(scope)) return false;
    return isArray(entries) && new Set(entries).size === entries.length && entries.every((key) => {
      if (!isString(key)) return false;
      const item = itemById.get(key);
      return !!item && (scope === "all" || (scope === "unfiled" ? item.projectId === null : item.projectId === scope));
    });
  });
  for (const item of items) {
    if (item.projectId !== null && !projectIds.has(item.projectId)) fail("items.projectId");
    if (item.image?.startsWith("local://") && (item.image.slice(8) !== item.id || !isOwnProperty(covers, item.id))) fail("items.image");
  }
  for (const project of projects) {
    if (project.coverPick?.some((key) => itemById.get(key)?.projectId !== project.id)) fail("projects.coverPick");
  }
  return { items, projects, covers, order, readingPositions };
}

// Normalize existing local data and discard orphaned derived references.
// Also handles the old inline covers/read flag without exporting caches.
export function fromStorage(stored: CollectionSnapshot, { resolveIcons = true }: { readonly resolveIcons?: boolean } = {}): BackupData {
  const projects = (stored.laterOnProjects || []).map((entry) => normalizeProject(entry, "local.projects"));
  const projectIds = new Set(projects.map((entry) => entry.id));
  const items = (stored.laterOnItems || []).map((entry) => {
    const favicon = isRecord(entry) && typeof entry.favicon === "string" && isIconReference(entry.favicon)
      ? (resolveIcons ? resolveFavicon(entry.favicon, stored.laterOnIcons || {}) : "") : null;
    if (resolveIcons && favicon === "") throw new Error("MISSING_LOCAL_ICON");
    const item = normalizeItem(favicon === null || !isRecord(entry) ? entry : { ...entry, favicon }, "local.items");
    return { ...item, projectId: item.projectId !== null && projectIds.has(item.projectId) ? item.projectId : null };
  });
  const itemById = new Map(items.map((entry) => [entry.id, entry]));
  const covers = Object.fromEntries(items.flatMap((item) => {
    const cover = item.image?.startsWith("data:") ? item.image : stored.laterOnCovers?.[item.id];
    return cover && isImageSource(cover) && cover.startsWith("data:") ? [[item.id, cover]] : [];
  }));
  const normalizedItems = items.map((item) => ({ ...item, image: item.image?.startsWith("data:") ? `local://${item.id}`
    : item.image?.startsWith("local://") ? (isOwnProperty(covers, item.id) ? `local://${item.id}` : "") : item.image || "" }));
  const order = Object.fromEntries(Object.entries(stored.laterOnOrder || {}).filter(([scope]) => ["all", "unfiled"].includes(scope) || projectIds.has(scope)).map(([scope, entries]) =>
    [scope, [...new Set((isArray(entries) ? entries : []).filter((key) => {
      if (!isString(key)) return false;
      const item = itemById.get(key);
      return item && (scope === "all" || (scope === "unfiled" ? !item.projectId : item.projectId === scope));
    }))]]));
  return validateData({
    items: normalizedItems,
    projects: projects.map((project) => ({ ...project, ...(project.coverPick ? { coverPick: project.coverPick.filter((key) => itemById.get(key)?.projectId === project.id) } : {}) })),
    covers, order,
    readingPositions: Object.fromEntries(Object.entries(stored.laterOnReadingPositions || {}).filter(([key, y]) => itemById.has(key) && isNonNegativeInteger(y)))
  });
}

export function parse(payload: unknown): BackupData {
  // Read the former built-in v2 export's standard fields; fork-specific state
  // has no meaning here. All new exports use the independent versioned format.
  if (isRecord(payload) && payload.type === "lateron-backup" && payload.version === 2) {
    if (!isArray(payload.items) || !isTimestamp(payload.exportedAt)) fail("legacy");
    const covers = isRecord(payload.covers) ? { ...payload.covers } : payload.covers ?? {};
    const items = payload.items.map((item) => {
      if (!isRecord(item) || !isString(item.image) || !item.image.startsWith("data:")) return item;
      if (!isValidId(item.id) || !isRecord(covers)) fail("legacy.covers");
      covers[item.id] = item.image;
      return { ...item, image: `local://${item.id}` };
    });
    return validateData({ items, projects: payload.projects, covers, order: payload.order ?? {}, readingPositions: {} });
  }
  if (!isRecord(payload) || payload.format !== FORMAT || payload.version !== VERSION) throw new Error("UNSUPPORTED_BACKUP");
  if (!isString(payload.exportedAt) || !Number.isFinite(Date.parse(payload.exportedAt))) fail("exportedAt");
  return validateData(payload.data);
}

const withoutImageData = (data: BackupData): BackupData => ({
  ...data,
  items: data.items.map((item) => ({ ...item, image: isHttpUrl(item.image) ? item.image : "",
    favicon: isHttpUrl(item.favicon) ? item.favicon : "" })),
  projects: data.projects.map((project) => ({ ...project, cover: isHttpUrl(project.cover) ? project.cover : "" })),
  covers: {}
});

export function create(stored: CollectionSnapshot, appVersion: string, exportedAt: string, { includeImages = false }: { readonly includeImages?: boolean } = {}): BackupDocument {
  const data = fromStorage(stored, { resolveIcons: includeImages });
  return { format: FORMAT, version: VERSION, appVersion, exportedAt,
    data: includeImages ? data : withoutImageData(data) };
}

export const toStorage = (data: BackupData): CollectionStorage => ({ laterOnItems: data.items, laterOnProjects: data.projects, laterOnCovers: data.covers,
  laterOnOrder: data.order, laterOnReadingPositions: data.readingPositions });

export const counts = (data: BackupData): BackupCounts => ({ items: data.items.length, projects: data.projects.length, covers: Object.keys(data.covers).length, positions: Object.keys(data.readingPositions).length });

// URL matches retain local metadata/project/progress. Colliding IDs are remapped,
// and every imported reference follows the same mapping.
export function merge(current: BackupData, incoming: BackupData, normalizeUrl: (url: string) => string, newId: () => string): MergeResult {
  const usedProjects = new Set(current.projects.map((entry) => entry.id));
  const usedItems = new Set(current.items.map((entry) => entry.id));
  const projectMap = new Map<string, string>();
  const projectById = new Map(current.projects.map((entry) => [entry.id, entry]));
  const allocate = (used: Set<string>, preferred: string): string => {
    let key = preferred;
    while (used.has(key)) key = newId();
    used.add(key);
    return key;
  };
  const newProjects = incoming.projects.flatMap((project) => {
    const byId = projectById.get(project.id);
    const existing = byId && byId.createdAt === project.createdAt ? byId : current.projects.find((entry) =>
      entry.createdAt === project.createdAt && entry.name === project.name);
    if (existing) {
      projectMap.set(project.id, existing.id);
      return [];
    }
    const key = allocate(usedProjects, project.id);
    projectMap.set(project.id, key);
    return [{ ...project, id: key }];
  });
  const byUrl = new Map(current.items.map((entry) => [normalizeUrl(entry.url), entry.id]));
  const itemMap = new Map<string, string>();
  const addedIds = new Set<string>();
  const acceptedSources = new Set<string>();
  const newItems = incoming.items.flatMap((item) => {
    const url = normalizeUrl(item.url);
    const existingId = byUrl.get(url);
    if (existingId !== undefined) { itemMap.set(item.id, existingId); return []; }
    const key = allocate(usedItems, item.id);
    byUrl.set(url, key);
    itemMap.set(item.id, key);
    addedIds.add(key);
    acceptedSources.add(item.id);
    return [{ ...item, id: key, projectId: item.projectId === null ? null : projectMap.get(item.projectId),
      image: item.image?.startsWith("local://") ? `local://${key}` : item.image || "" }];
  });
  const items = [...current.items, ...newItems];
  const itemById = new Map(items.map((entry) => [entry.id, entry]));
  const projects = [...current.projects, ...newProjects.map((project) => ({ ...project,
    ...(project.coverPick ? { coverPick: [...new Set(project.coverPick.map((key) => itemMap.get(key)))].filter((key): key is string => key !== undefined && itemById.get(key)?.projectId === project.id) } : {}) }))];
  const remapDictionary = <T>(entries: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(entries).flatMap(([key, value]) => {
    const mapped = itemMap.get(key);
    return acceptedSources.has(key) && mapped !== undefined ? [[mapped, value]] : [];
  }));
  const order = { ...current.order };
  for (const [scope, entries] of Object.entries(incoming.order)) {
    const target = ["all", "unfiled"].includes(scope) ? scope : projectMap.get(scope);
    if (target === undefined) fail("order");
    const mapped = entries.map((key) => itemMap.get(key)).filter((key): key is string => {
      if (key === undefined) return false;
      const item = itemById.get(key);
      return !!item && addedIds.has(key) && (target === "all" || (target === "unfiled" ? !item.projectId : item.projectId === target));
    });
    order[target] = [...new Set([...(order[target] || []), ...mapped])];
  }
  const data = validateData({ items, projects, covers: { ...current.covers, ...remapDictionary(incoming.covers) },
    order, readingPositions: { ...current.readingPositions, ...remapDictionary(incoming.readingPositions) } });
  return { data, added: newItems.length, duplicates: incoming.items.length - newItems.length, addedProjects: newProjects.length };
}
