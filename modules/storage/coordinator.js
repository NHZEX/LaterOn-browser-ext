// Collection commands read and modify current data inside one shared worker queue.
/**
 * @typedef {{title?:string, description?:string, titleEdited?:boolean,
 * descriptionEdited?:boolean, imageEdited?:boolean, status?:'unread'|'reading'|'done',
 * projectId?:string|null, cover?:string}} ItemChanges
 * @typedef {{name?:string, note?:string, cover?:string, coverPick?:string[], archived?:boolean}} ProjectChanges
 * @typedef {{action:'createProject', name:string}
 * | {action:'updateProject', id:string, changes:ProjectChanges}
 * | {action:'setProjectPinned', id:string, pinned:boolean}
 * | {action:'moveProject', id:string, beforeId:string|null}
 * | {action:'deleteProject', id:string}
 * | {action:'moveItem', id:string, scope:string, beforeId:string|null}
 * | {action:'mutateItems', operation:'update'|'delete', ids:string[], patch?:ItemChanges}
 * | {action:'migrateLegacyData'}} CollectionOperation
 * @typedef {CollectionOperation & {epoch?:string}} CollectionCommand
 * @typedef {{ok:true, items?:BackupItem[], projects?:BackupProject[], project?:BackupProject,
 * covers?:Record<string,string>, orders?:Record<string,string[]>, affected?:number, existed?:boolean}} CollectionCommandResult
 */
(function () {
  const ITEMS = "laterOnItems", PROJECTS = "laterOnProjects", COVERS = "laterOnCovers";
  const ORDER = "laterOnOrder", POSITIONS = "laterOnReadingPositions";
  const CURRENT = "laterOnCurrentItem", ACTIVE = "laterOnActiveProject";
  const KEYS = [ITEMS, PROJECTS, COVERS, ORDER, POSITIONS];
  const EPOCH = "laterOnCollectionEpoch";
  let pending = Promise.resolve();
  const enqueue = (task) => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const fail = (code) => { throw new Error(code); };
  const assertEpoch = (stored, epoch) => {
    if (epoch !== undefined && (stored[EPOCH] || "") !== epoch) fail("STALE_COLLECTION");
  };
  const result = (patch, response = {}) => ({ patch, response });
  const insertBefore = (list, entry, anchorId) => {
    const index = list.findIndex((value) => value.id === anchorId);
    const at = index < 0 ? list.length : index;
    return [...list.slice(0, at), entry, ...list.slice(at)];
  };
  const grouped = (projects) => [...projects.filter((p) => p.pinned), ...projects.filter((p) => !p.pinned)];
  const projectIn = (projects, id) => projects.find((p) => p.id === id) || fail("PROJECT_NOT_FOUND");
  const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, 28);
  const validName = (projects, name, id) => {
    const clean = cleanName(name);
    if (!clean) fail("INVALID_PROJECT_NAME");
    if (projects.some((p) => p.id !== id && p.name === clean)) fail("DUPLICATE_PROJECT_NAME");
    return clean;
  };
  const pruneProjectPicks = (projects, items) => projects.map((project) => {
    if (!Array.isArray(project.coverPick)) return project;
    const alive = new Set(items.filter((item) => item.projectId === project.id).map((item) => item.id));
    const picks = project.coverPick.filter((id) => alive.has(id));
    const { coverPick, ...fields } = project;
    return picks.length ? { ...fields, coverPick: picks } : fields;
  });

  function createProject(stored, { name }) {
    const projects = stored[PROJECTS] || [];
    const clean = cleanName(name);
    if (!clean) fail("INVALID_PROJECT_NAME");
    const existing = projects.find((p) => p.name === clean);
    if (existing) return result({}, { project: existing, projects, existed: true });
    const project = { id: crypto.randomUUID(), name: clean, createdAt: Date.now() };
    const next = [...projects, project];
    return result({ [PROJECTS]: next }, { project, projects: next, existed: false });
  }

  function updateProject(stored, { id, changes }) {
    const projects = stored[PROJECTS] || [];
    const project = projectIn(projects, id);
    const fields = ["name", "note", "cover", "coverPick", "archived"];
    if (!changes || Object.keys(changes).some((key) => !fields.includes(key))) fail("INVALID_PROJECT_CHANGE");
    const patch = { ...changes };
    if ("name" in patch) patch.name = validName(projects, patch.name, id);
    if (["note", "cover"].some((key) => key in patch && typeof patch[key] !== "string")
      || ("archived" in patch && typeof patch.archived !== "boolean")) fail("INVALID_PROJECT_CHANGE");
    if ("coverPick" in patch) {
      if (!Array.isArray(patch.coverPick)) fail("INVALID_PROJECT_CHANGE");
      const alive = new Set((stored[ITEMS] || []).filter((item) => item.projectId === id).map((item) => item.id));
      patch.coverPick = [...new Set(patch.coverPick)].filter((itemId) => alive.has(itemId)).slice(0, 3);
    }
    const updated = { ...project, ...patch };
    if (updated.coverPick?.length === 0) delete updated.coverPick;
    const next = projects.map((p) => p.id === id ? updated : p);
    return result({ [PROJECTS]: next }, { projects: next, project: updated });
  }

  function setProjectPinned(stored, { id, pinned }) {
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
    const at = pinned ? pins : pins + (Number.isInteger(pinFrom) ? Math.max(0, Math.min(pinFrom, plain)) : 0);
    const next = [...rest.slice(0, at), updated, ...rest.slice(at)];
    return result({ [PROJECTS]: next }, { projects: next, project: updated });
  }

  function moveProject(stored, { id, beforeId }) {
    const projects = grouped(stored[PROJECTS] || []);
    const project = projectIn(projects, id);
    const rest = projects.filter((p) => p.id !== id);
    const partition = rest.filter((p) => !!p.pinned === !!project.pinned);
    const moved = insertBefore(partition, project, beforeId);
    const next = project.pinned ? [...moved, ...rest.filter((p) => !p.pinned)] : [...rest.filter((p) => p.pinned), ...moved];
    return result(equal(projects, next) ? {} : { [PROJECTS]: next }, { projects: next });
  }

  function deleteProject(stored, { id }) {
    const projects = stored[PROJECTS] || [];
    projectIn(projects, id);
    const removed = new Set((stored[ITEMS] || []).filter((item) => item.projectId === id).map((item) => item.id));
    const withoutRemoved = (map) => Object.fromEntries(Object.entries(map || {}).filter(([key]) => !removed.has(key)));
    const patch = {
      [PROJECTS]: projects.filter((p) => p.id !== id),
      [ITEMS]: (stored[ITEMS] || []).filter((item) => !removed.has(item.id)),
      [COVERS]: withoutRemoved(stored[COVERS]), [POSITIONS]: withoutRemoved(stored[POSITIONS]),
      [ORDER]: Object.fromEntries(Object.entries(stored[ORDER] || {}).filter(([scope]) => scope !== id)
        .map(([scope, ids]) => [scope, ids.filter((itemId) => !removed.has(itemId))]))
    };
    if (removed.has(stored[CURRENT])) patch[CURRENT] = null;
    if (stored[ACTIVE] === id) patch[ACTIVE] = "all";
    return result(patch, { projects: patch[PROJECTS], items: patch[ITEMS], covers: patch[COVERS], orders: patch[ORDER], affected: removed.size });
  }

  function moveItem(stored, { id, scope, beforeId }) {
    if (scope !== "all" && scope !== "unfiled") projectIn(stored[PROJECTS] || [], scope);
    const items = (stored[ITEMS] || []).filter((item) => scope === "all" || (scope === "unfiled" ? !item.projectId : item.projectId === scope));
    if (!items.some((item) => item.id === id)) fail("ITEM_NOT_FOUND");
    const orders = stored[ORDER] || {};
    const alive = new Set(items.map((item) => item.id));
    const saved = [...new Set(Array.isArray(orders[scope]) ? orders[scope] : [])].filter((itemId) => alive.has(itemId));
    const rest = items.filter((item) => !saved.includes(item.id)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map((item) => item.id);
    const full = [...saved, ...rest].filter((itemId) => itemId !== id).map((itemId) => ({ id: itemId }));
    const next = { ...orders, [scope]: insertBefore(full, { id }, beforeId).map((item) => item.id) };
    return result({ [ORDER]: next }, { orders: next });
  }

  function mutateItems(stored, { operation, ids, patch = {} }) {
    if (!["delete", "update"].includes(operation) || !Array.isArray(ids) || ids.some((id) => typeof id !== "string")) fail("Invalid item mutation");
    const allowed = ["title", "description", "titleEdited", "descriptionEdited", "imageEdited", "status", "projectId", "cover"];
    if (!patch || Object.keys(patch).some((key) => !allowed.includes(key))) fail("Invalid item mutation");
    if (patch.status && !["unread", "reading", "done"].includes(patch.status)) fail("Invalid item mutation");
    if (patch.projectId) {
      const project = projectIn(stored[PROJECTS] || [], patch.projectId);
      if (project.archived) fail("PROJECT_ARCHIVED");
    }
    if ("cover" in patch && (typeof patch.cover !== "string" || (patch.cover && !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(patch.cover)))) fail("INVALID_COVER");
    const targets = new Set(ids);
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
    const write = { [ITEMS]: items };
    if (operation === "delete") {
      ids.forEach((id) => { delete covers[id]; });
      write[COVERS] = covers;
      write[ORDER] = Object.fromEntries(Object.entries(stored[ORDER] || {}).map(([scope, list]) => [scope, list.filter((id) => !targets.has(id))]));
      write[POSITIONS] = Object.fromEntries(Object.entries(stored[POSITIONS] || {}).filter(([id]) => !targets.has(id)));
      if (targets.has(stored[CURRENT])) write[CURRENT] = null;
    } else if ("cover" in patch) {
      original.filter((item) => targets.has(item.id)).forEach((item) => { if (cover) covers[item.id] = cover; else delete covers[item.id]; });
      write[COVERS] = covers;
    }
    if (operation === "delete" || "projectId" in patch) {
      const projects = stored[PROJECTS] || [];
      const next = pruneProjectPicks(projects, items);
      if (!equal(projects, next)) write[PROJECTS] = next;
    }
    return result(write, { items, covers, affected });
  }

  function migrateLegacyData(stored) {
    const original = stored[ITEMS] || [];
    const covers = { ...(stored[COVERS] || {}) };
    const items = original.filter(Boolean).map((item) => {
      const status = item.status || (item.read ? "done" : "unread");
      const inline = typeof item.image === "string" && item.image.startsWith("data:");
      if (inline) covers[item.id] = item.image;
      return { ...item, status, doneAt: status === "done" ? Number(item.doneAt) || Date.now() : null,
        ...(inline ? { image: `local://${item.id}` } : {}) };
    });
    const patch = { ...(!equal(original, items) ? { [ITEMS]: items } : {}), ...(!equal(stored[COVERS] || {}, covers) ? { [COVERS]: covers } : {}) };
    return result(patch, { items, covers });
  }

  const handlers = { createProject, updateProject, setProjectPinned, moveProject, deleteProject, moveItem, mutateItems, migrateLegacyData };
  const readKeys = {
    createProject: [PROJECTS], updateProject: [PROJECTS, ITEMS], setProjectPinned: [PROJECTS], moveProject: [PROJECTS],
    deleteProject: [...KEYS, CURRENT, ACTIVE], moveItem: [ITEMS, PROJECTS, ORDER],
    mutateItems: [...KEYS, CURRENT], migrateLegacyData: [ITEMS, COVERS]
  };

  /**
   * Execute a named business operation against the latest persisted collection.
   * @param {CollectionCommand} command
   * @returns {Promise<CollectionCommandResult>}
   */
  async function execute(command) {
    if (!Object.prototype.hasOwnProperty.call(handlers, command?.action)) fail("INVALID_OPERATION");
    return enqueue(async () => {
      const stored = await chrome.storage.local.get([...readKeys[command.action], EPOCH]);
      assertEpoch(stored, command.epoch);
      const { patch, response } = handlers[command.action](stored, command);
      if (Object.keys(patch).length) await chrome.storage.local.set(patch);
      return { ok: true, ...response };
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "COLLECTION_COMMAND") return;
    if (typeof message.epoch !== "string" || (sender?.tab && !String(sender.url || "").startsWith(chrome.runtime.getURL("")))) {
      respond({ ok: false, error: "INVALID_SENDER" });
      return;
    }
    execute(message).then(respond).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });

  globalThis.LaterOnCollection = { KEYS, EPOCH, enqueue, execute };
})();
