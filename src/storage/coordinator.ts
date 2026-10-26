import { browser } from "wxt/browser";
import { normalizeItemState } from "../collection/item-state";
import {
  ITEMS, PROJECTS, COVERS, ORDER, POSITIONS, CURRENT, ACTIVE, KEYS, EPOCH,
  isRecord, isCollectionCommand
} from "./contracts";
import type {
  CollectionState, LegacyCollectionState, StoredItem, StoredProject, CollectionAction,
  CollectionCommand, CollectionResponse, CollectionSuccess, Operation
} from "./contracts";

export { KEYS, EPOCH };

// One worker queue is shared by commands, saves, imports and reading positions.
// 后台保存只串行化读改写这一小段；网页抓取和提示不占用队列。
// 每次提交都读取最新列表，避免批量抓取期间的单篇保存被旧快照覆盖。
let pending: Promise<unknown> = Promise.resolve();
export function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const next = pending.then(task);
  pending = next.catch(() => {});
  return next;
}

interface Mutation {
  readonly patch: CollectionState;
  readonly response: CollectionResponse;
}

const isEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
function fail(code: string): never { throw new Error(code); }
const result = (patch: CollectionState, response: CollectionResponse = {}): Mutation => ({ patch, response });
const assertEpoch = (stored: CollectionState, epoch: string | undefined): void => {
  if (epoch !== undefined && (stored[EPOCH] || "") !== epoch) fail("STALE_COLLECTION");
};
const insertBefore = <T extends { readonly id: string }>(list: readonly T[], entry: T, anchorId: string | null): T[] => {
  const index = list.findIndex((value) => value.id === anchorId);
  const at = index < 0 ? list.length : index;
  return [...list.slice(0, at), entry, ...list.slice(at)];
};
const grouped = (projects: readonly StoredProject[]): StoredProject[] => [...projects.filter((p) => p.pinned), ...projects.filter((p) => !p.pinned)];
const projectIn = (projects: readonly StoredProject[], id: string): StoredProject => projects.find((p) => p.id === id) || fail("PROJECT_NOT_FOUND");
const cleanName = (name: string | undefined): string => String(name || "").replace(/\s+/g, " ").trim().slice(0, 28);
const validName = (projects: readonly StoredProject[], name: string | undefined, id: string): string => {
  const clean = cleanName(name);
  if (!clean) fail("INVALID_PROJECT_NAME");
  if (projects.some((p) => p.id !== id && p.name === clean)) fail("DUPLICATE_PROJECT_NAME");
  return clean;
};
const pruneProjectPicks = (projects: readonly StoredProject[], items: readonly StoredItem[]): StoredProject[] => projects.map((project) => {
  if (!Array.isArray(project.coverPick)) return project;
  const alive = new Set(items.filter((item) => item.projectId === project.id).map((item) => item.id));
  const picks = project.coverPick.filter((id: string) => alive.has(id));
  const { coverPick, ...fields } = project;
  return picks.length ? { ...fields, coverPick: picks } : fields;
});

function createProject(stored: CollectionState, { name }: Operation<"createProject">): Mutation {
  const projects = stored[PROJECTS] || [];
  const clean = cleanName(name);
  if (!clean) fail("INVALID_PROJECT_NAME");
  const existing = projects.find((p) => p.name === clean);
  if (existing) return result({}, { project: existing, projects, existed: true });
  const project = { id: crypto.randomUUID(), name: clean, createdAt: Date.now() };
  const next = [...projects, project];
  return result({ [PROJECTS]: next }, { project, projects: next, existed: false });
}

function updateProject(stored: CollectionState, { id, changes }: Operation<"updateProject">): Mutation {
  const projects = stored[PROJECTS] || [];
  const project = projectIn(projects, id);
  const fields = ["name", "note", "cover", "coverPick", "archived"];
  if (!changes || Object.keys(changes).some((key) => !fields.includes(key))) fail("INVALID_PROJECT_CHANGE");
  const patch = { ...changes };
  if ("name" in patch) patch.name = validName(projects, patch.name, id);
  if (("note" in patch && typeof patch.note !== "string") || ("cover" in patch && typeof patch.cover !== "string")
    || ("archived" in patch && typeof patch.archived !== "boolean")) fail("INVALID_PROJECT_CHANGE");
  if ("coverPick" in patch) {
    if (!Array.isArray(patch.coverPick)) fail("INVALID_PROJECT_CHANGE");
    const alive = new Set((stored[ITEMS] || []).filter((item) => item.projectId === id).map((item) => item.id));
    patch.coverPick = [...new Set<string>(patch.coverPick)].filter((itemId) => alive.has(itemId)).slice(0, 3);
  }
  const updated = { ...project, ...patch };
  if (updated.coverPick?.length === 0) delete updated.coverPick;
  const next = projects.map((p) => p.id === id ? updated : p);
  return result({ [PROJECTS]: next }, { projects: next, project: updated });
}

function setProjectPinned(stored: CollectionState, { id, pinned }: Operation<"setProjectPinned">): Mutation {
  if (typeof pinned !== "boolean") fail("INVALID_PROJECT_CHANGE");
  const projects = grouped(stored[PROJECTS] || []);
  const project = projectIn(projects, id);
  if (!!project.pinned === pinned) return result({}, { projects, project });
  const rest = projects.filter((p) => p.id !== id);
  const pins = rest.filter((p) => p.pinned).length;
  const plain = rest.length - pins;
  const { pinned: oldPinned, pinFrom, ...fields } = project;
  const updated = pinned
    ? { ...fields, pinned: true, pinFrom: projects.filter((p) => !p.pinned).findIndex((p) => p.id === id) }
    : fields;
  const at = pinned ? pins : pins + (pinFrom !== undefined && Number.isInteger(pinFrom) ? Math.max(0, Math.min(pinFrom, plain)) : 0);
  const next = [...rest.slice(0, at), updated, ...rest.slice(at)];
  return result({ [PROJECTS]: next }, { projects: next, project: updated });
}

function moveProject(stored: CollectionState, { id, beforeId }: Operation<"moveProject">): Mutation {
  const projects = grouped(stored[PROJECTS] || []);
  const project = projectIn(projects, id);
  const rest = projects.filter((p) => p.id !== id);
  const partition = rest.filter((p) => !!p.pinned === !!project.pinned);
  const moved = insertBefore(partition, project, beforeId);
  const next = project.pinned ? [...moved, ...rest.filter((p) => !p.pinned)] : [...rest.filter((p) => p.pinned), ...moved];
  return result(isEqual(projects, next) ? {} : { [PROJECTS]: next }, { projects: next });
}

function deleteProject(stored: CollectionState, { id }: Operation<"deleteProject">): Mutation {
  const projects = stored[PROJECTS] || [];
  projectIn(projects, id);
  const removed = new Set((stored[ITEMS] || []).filter((item) => item.projectId === id).map((item) => item.id));
  const withoutRemoved = <T>(map: Readonly<Record<string, T>> | undefined): Record<string, T> =>
    Object.fromEntries(Object.entries(map || {}).filter(([key]) => !removed.has(key)));
  const patch = {
    [PROJECTS]: projects.filter((p) => p.id !== id),
    [ITEMS]: (stored[ITEMS] || []).filter((item) => !removed.has(item.id)),
    [COVERS]: withoutRemoved(stored[COVERS]), [POSITIONS]: withoutRemoved(stored[POSITIONS]),
    [ORDER]: Object.fromEntries(Object.entries(stored[ORDER] || {}).filter(([scope]) => scope !== id)
      .map(([scope, ids]) => [scope, ids.filter((itemId) => !removed.has(itemId))])),
    ...(stored[CURRENT] != null && removed.has(stored[CURRENT]) ? { [CURRENT]: null } : {}),
    ...(stored[ACTIVE] === id ? { [ACTIVE]: "all" } : {})
  };
  return result(patch, { projects: patch[PROJECTS], items: patch[ITEMS], covers: patch[COVERS], orders: patch[ORDER], affected: removed.size });
}

function moveItem(stored: CollectionState, { id, scope, beforeId }: Operation<"moveItem">): Mutation {
  if (scope !== "all" && scope !== "unfiled") projectIn(stored[PROJECTS] || [], scope);
  const items = (stored[ITEMS] || []).filter((item) => scope === "all" || (scope === "unfiled" ? !item.projectId : item.projectId === scope));
  if (!items.some((item) => item.id === id)) fail("ITEM_NOT_FOUND");
  const orders = stored[ORDER] || {};
  const alive = new Set(items.map((item) => item.id));
  const saved = [...new Set<string>(Array.isArray(orders[scope]) ? orders[scope] : [])].filter((itemId) => alive.has(itemId));
  const rest = items.filter((item) => !saved.includes(item.id)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map((item) => item.id);
  const full = [...saved, ...rest].filter((itemId) => itemId !== id).map((itemId) => ({ id: itemId }));
  const next = { ...orders, [scope]: insertBefore(full, { id }, beforeId).map((item) => item.id) };
  return result({ [ORDER]: next }, { orders: next });
}

function mutateItems(stored: CollectionState, { operation, ids, patch = {} }: Operation<"mutateItems">): Mutation {
  if (!["delete", "update"].includes(operation) || !Array.isArray(ids) || ids.some((id) => typeof id !== "string")) fail("Invalid item mutation");
  const allowed = ["title", "description", "titleEdited", "descriptionEdited", "imageEdited", "status", "projectId", "cover"];
  if (!patch || Object.keys(patch).some((key) => !allowed.includes(key))) fail("Invalid item mutation");
  if (patch.status && !["unread", "reading", "done"].includes(patch.status)) fail("Invalid item mutation");
  if (patch.projectId) {
    const project = projectIn(stored[PROJECTS] || [], patch.projectId);
    if (project.archived) fail("PROJECT_ARCHIVED");
  }
  if ("cover" in patch && (typeof patch.cover !== "string" || (patch.cover && !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(patch.cover)))) fail("INVALID_COVER");
  const targets = new Set<string>(ids);
  const original = stored[ITEMS] || [];
  const affected = original.filter((item) => targets.has(item.id)).length;
  const { cover, ...changes } = patch;
  const items = operation === "delete" ? original.filter((item) => !targets.has(item.id)) : original.map((item) => {
    if (!targets.has(item.id)) return item;
    const status = changes.status;
    return { ...item, ...changes,
      ...(status ? { read: status === "done", doneAt: status === "done" ? (item.status === "done" && Number(item.doneAt) ? item.doneAt : Date.now()) : null } : {}),
      ...("cover" in patch ? { image: cover ? `local://${item.id}` : "", imageEdited: true } : {}) };
  });
  const covers = { ...(stored[COVERS] || {}) };
  const write: { -readonly [K in keyof CollectionState]: CollectionState[K] } = { [ITEMS]: items };
  if (operation === "delete") {
    ids.forEach((id: string) => { delete covers[id]; });
    write[COVERS] = covers;
    write[ORDER] = Object.fromEntries(Object.entries(stored[ORDER] || {}).map(([scope, list]) => [scope, list.filter((id) => !targets.has(id))]));
    write[POSITIONS] = Object.fromEntries(Object.entries(stored[POSITIONS] || {}).filter(([id]) => !targets.has(id)));
    if (stored[CURRENT] != null && targets.has(stored[CURRENT])) write[CURRENT] = null;
  } else if ("cover" in patch) {
    original.filter((item) => targets.has(item.id)).forEach((item) => { if (cover) covers[item.id] = cover; else delete covers[item.id]; });
    write[COVERS] = covers;
  }
  if (operation === "delete" || "projectId" in patch) {
    const projects = stored[PROJECTS] || [];
    const next = pruneProjectPicks(projects, items);
    if (!isEqual(projects, next)) write[PROJECTS] = next;
  }
  return result(write, { items, covers, affected });
}

function migrateLegacyData(stored: LegacyCollectionState): Mutation {
  const original = stored[ITEMS] || [];
  const covers = { ...(stored[COVERS] || {}) };
  const items = original.filter((item): item is StoredItem => !!item).map((item) => {
    const { status, doneAt } = normalizeItemState(item);
    const inline = typeof item.image === "string" && item.image.startsWith("data:");
    if (inline && item.image !== undefined) covers[item.id] = item.image;
    return { ...item, status, doneAt: status === "done" ? doneAt || Date.now() : null,
      ...(inline ? { image: `local://${item.id}` } : {}) };
  });
  const patch = { ...(!isEqual(original, items) ? { [ITEMS]: items } : {}), ...(!isEqual(stored[COVERS] || {}, covers) ? { [COVERS]: covers } : {}) };
  return result(patch, { items, covers });
}

const readKeys = {
  createProject: [PROJECTS], updateProject: [PROJECTS, ITEMS], setProjectPinned: [PROJECTS], moveProject: [PROJECTS],
  deleteProject: [...KEYS, CURRENT, ACTIVE], moveItem: [ITEMS, PROJECTS, ORDER],
  mutateItems: [...KEYS, CURRENT], migrateLegacyData: [ITEMS, COVERS]
} satisfies Record<CollectionAction, readonly (keyof CollectionState)[]>;

function applyOperation(stored: CollectionState, command: CollectionCommand): Mutation {
  switch (command.action) {
    case "createProject": return createProject(stored, command);
    case "updateProject": return updateProject(stored, command);
    case "setProjectPinned": return setProjectPinned(stored, command);
    case "moveProject": return moveProject(stored, command);
    case "deleteProject": return deleteProject(stored, command);
    case "moveItem": return moveItem(stored, command);
    case "mutateItems": return mutateItems(stored, command);
    case "migrateLegacyData": return migrateLegacyData(stored);
  }
}

export async function execute(command: CollectionCommand): Promise<CollectionSuccess> {
  if (!Object.hasOwn(readKeys, command?.action)) fail("INVALID_OPERATION");
  return enqueue(async () => {
    const stored = await browser.storage.local.get<CollectionState>([...readKeys[command.action], EPOCH]);
    assertEpoch(stored, command.epoch);
    const { patch, response } = applyOperation(stored, command);
    if (Object.keys(patch).length) await browser.storage.local.set(patch);
    return { ok: true, ...response };
  });
}

export function registerMessages(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== "COLLECTION_COMMAND") return;
    if (typeof message.epoch !== "string" || (sender?.tab && !String(sender.url || "").startsWith(browser.runtime.getURL("")))) {
      respond({ ok: false, error: "INVALID_SENDER" });
      return;
    }
    if (!isCollectionCommand(message)) {
      respond({ ok: false, error: "INVALID_OPERATION" });
      return;
    }
    execute(message).then(respond).catch((error: unknown) => respond({ ok: false, error: isRecord(error) && typeof error.message === "string" ? error.message : String(error) }));
    return true;
  });
}
