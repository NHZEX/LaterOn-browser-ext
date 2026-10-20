// Portable collection format. No Chrome API, DOM, or implicit clock/randomness.
/**
 * @typedef {{id:string, url:string, savedAt:number, projectId:string|null,
 * status:'unread'|'reading'|'done', read:boolean, doneAt:number|null,
 * title?:string, description?:string, image?:string, favicon?:string, source?:string,
 * titleEdited?:boolean, descriptionEdited?:boolean, imageEdited?:boolean}} BackupItem
 * @typedef {{id:string, name:string, createdAt:number, note?:string, cover?:string,
 * coverPick?:string[], archived?:boolean, pinned?:boolean, pinFrom?:number}} BackupProject
 * @typedef {{items:BackupItem[], projects:BackupProject[], covers:Record<string,string>,
 * order:Record<string,string[]>, readingPositions:Record<string,number>}} BackupData
 * @typedef {{laterOnItems?:unknown[], laterOnProjects?:unknown[], laterOnCovers?:Record<string,string>,
 * laterOnOrder?:Record<string,string[]>, laterOnReadingPositions?:Record<string,number>}} CollectionSnapshot
 */
(function () {
  const FORMAT = "lateron.collection";
  const VERSION = 1;
  const MAX_BYTES = 50 * 1024 * 1024;
  const record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const fail = (path) => { throw new Error(`INVALID_BACKUP:${path}`); };
  const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 200
    && !["__proto__", "prototype", "constructor", "all", "unfiled", "archive"].includes(value);
  const text = (value) => typeof value === "string";
  const time = (value) => Number.isFinite(value) && value >= 0;
  const web = (value) => {
    try { return text(value) && ["http:", "https:"].includes(new URL(value).protocol); }
    catch { return false; }
  };
  const image = (value) => text(value) && (!value || web(value) || /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value));
  const fields = (value, checks, path) => {
    if (!record(value)) fail(path);
    for (const [key, check] of Object.entries(checks)) {
      if (own(value, key) && !check(value[key])) fail(`${path}.${key}`);
    }
    return Object.fromEntries(Object.keys(checks).filter((key) => own(value, key)).map((key) => [key, value[key]]));
  };
  const dictionary = (value, path, check) => {
    if (!record(value)) fail(path);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (!["all", "unfiled"].includes(key) && !id(key)) fail(`${path}.key`);
      if (!check(entry, key)) fail(`${path}.${key}`);
      return [key, entry];
    }));
  };
  const uniqueRecords = (entries, path, normalize) => {
    if (!Array.isArray(entries)) fail(path);
    const result = entries.map((entry, index) => normalize(entry, `${path}[${index}]`));
    if (new Set(result.map((entry) => entry.id)).size !== result.length) fail(`${path}.duplicateId`);
    return result;
  };

  function normalizeItem(entry, path) {
    if (!id(entry?.id) || !web(entry?.url) || !time(entry?.savedAt)) fail(path);
    const item = fields(entry, {
      id, url: web, title: text, description: text, image: (value) => image(value) || (text(value) && value.startsWith("local://") && id(value.slice(8))),
      favicon: image, source: text, projectId: (value) => value === null || id(value), savedAt: time,
      status: (value) => ["unread", "reading", "done"].includes(value), read: (value) => typeof value === "boolean",
      doneAt: (value) => value === null || time(value),
      titleEdited: (value) => typeof value === "boolean", descriptionEdited: (value) => typeof value === "boolean", imageEdited: (value) => typeof value === "boolean"
    }, path);
    const status = item.status || (item.read ? "done" : "unread");
    return { ...item, projectId: item.projectId ?? null, status, read: status === "done", doneAt: status === "done" ? item.doneAt ?? null : null };
  }

  function normalizeProject(entry, path) {
    if (!id(entry?.id) || !text(entry?.name) || !entry.name.trim() || !time(entry?.createdAt)) fail(path);
    return fields(entry, {
      id, name: text, createdAt: time, note: text, cover: image,
      coverPick: (value) => Array.isArray(value) && value.length <= 3 && value.every(id) && new Set(value).size === value.length,
      archived: (value) => typeof value === "boolean", pinned: (value) => typeof value === "boolean",
      pinFrom: (value) => Number.isInteger(value) && value >= 0
    }, path);
  }

  /** @param {unknown} value @returns {BackupData} */
  function validateData(value) {
    if (!record(value)) fail("data");
    const items = uniqueRecords(value.items, "items", normalizeItem);
    const projects = uniqueRecords(value.projects, "projects", normalizeProject);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const projectIds = new Set(projects.map((project) => project.id));
    const covers = dictionary(value.covers, "covers", (entry, key) => itemById.has(key) && image(entry) && entry.startsWith("data:"));
    const readingPositions = dictionary(value.readingPositions, "readingPositions", (entry, key) => itemById.has(key) && Number.isInteger(entry) && entry >= 0);
    const order = dictionary(value.order, "order", (entries, scope) => {
      if (!["all", "unfiled"].includes(scope) && !projectIds.has(scope)) return false;
      return Array.isArray(entries) && new Set(entries).size === entries.length && entries.every((key) => {
        const item = itemById.get(key);
        return item && (scope === "all" || (scope === "unfiled" ? item.projectId === null : item.projectId === scope));
      });
    });
    for (const item of items) {
      if (item.projectId !== null && !projectIds.has(item.projectId)) fail("items.projectId");
      if (item.image?.startsWith("local://") && (item.image.slice(8) !== item.id || !own(covers, item.id))) fail("items.image");
    }
    for (const project of projects) {
      if (project.coverPick?.some((key) => itemById.get(key)?.projectId !== project.id)) fail("projects.coverPick");
    }
    return { items, projects, covers, order, readingPositions };
  }

  // Normalize existing local data and discard orphaned derived references. This
  // also handles the old inline covers/read flag without exporting caches.
  /** @param {CollectionSnapshot} stored @returns {BackupData} */
  function fromStorage(stored) {
    const projects = (stored.laterOnProjects || []).map((entry) => normalizeProject(entry, "local.projects"));
    const projectIds = new Set(projects.map((entry) => entry.id));
    const items = (stored.laterOnItems || []).map((entry) => {
      const item = normalizeItem(entry, "local.items");
      return { ...item, projectId: projectIds.has(item.projectId) ? item.projectId : null };
    });
    const itemById = new Map(items.map((entry) => [entry.id, entry]));
    const covers = Object.fromEntries(items.flatMap((item) => {
      const cover = item.image?.startsWith("data:") ? item.image : stored.laterOnCovers?.[item.id];
      return cover && image(cover) && cover.startsWith("data:") ? [[item.id, cover]] : [];
    }));
    const normalizedItems = items.map((item) => ({ ...item, image: item.image?.startsWith("data:") ? `local://${item.id}`
      : item.image?.startsWith("local://") ? (own(covers, item.id) ? `local://${item.id}` : "") : item.image || "" }));
    const order = Object.fromEntries(Object.entries(stored.laterOnOrder || {}).filter(([scope]) => ["all", "unfiled"].includes(scope) || projectIds.has(scope)).map(([scope, entries]) =>
      [scope, [...new Set((Array.isArray(entries) ? entries : []).filter((key) => {
        const item = itemById.get(key);
        return item && (scope === "all" || (scope === "unfiled" ? !item.projectId : item.projectId === scope));
      }))]]));
    return validateData({
      items: normalizedItems,
      projects: projects.map((project) => ({ ...project, ...(project.coverPick ? { coverPick: project.coverPick.filter((key) => itemById.get(key)?.projectId === project.id) } : {}) })),
      covers, order,
      readingPositions: Object.fromEntries(Object.entries(stored.laterOnReadingPositions || {}).filter(([key, y]) => itemById.has(key) && Number.isInteger(y) && y >= 0))
    });
  }

  /** @param {unknown} payload @returns {BackupData} */
  function parse(payload) {
    // Read the former built-in v2 export's standard fields; fork-specific state
    // has no meaning here. All new exports use the independent versioned format.
    if (record(payload) && payload.type === "lateron-backup" && payload.version === 2) {
      if (!Array.isArray(payload.items) || !time(payload.exportedAt)) fail("legacy");
      const covers = record(payload.covers) ? { ...payload.covers } : payload.covers ?? {};
      const items = payload.items.map((item) => {
        if (!item?.image?.startsWith?.("data:")) return item;
        if (!id(item.id) || !record(covers)) fail("legacy.covers");
        covers[item.id] = item.image;
        return { ...item, image: `local://${item.id}` };
      });
      return validateData({ items, projects: payload.projects, covers, order: payload.order ?? {}, readingPositions: {} });
    }
    if (!record(payload) || payload.format !== FORMAT || payload.version !== VERSION) throw new Error("UNSUPPORTED_BACKUP");
    if (!text(payload.exportedAt) || !Number.isFinite(Date.parse(payload.exportedAt))) fail("exportedAt");
    return validateData(payload.data);
  }

  /** @param {BackupData} data @returns {BackupData} */
  const withoutImageData = (data) => ({
    ...data,
    items: data.items.map((item) => ({ ...item, image: web(item.image) ? item.image : "",
      favicon: web(item.favicon) ? item.favicon : "" })),
    projects: data.projects.map((project) => ({ ...project, cover: web(project.cover) ? project.cover : "" })),
    covers: {}
  });
  /**
   * @param {CollectionSnapshot} stored @param {string} appVersion @param {string} exportedAt
   * @param {{includeImages?:boolean}} [options]
   */
  const create = (stored, appVersion, exportedAt, { includeImages = false } = {}) => {
    const data = fromStorage(stored);
    return { format: FORMAT, version: VERSION, appVersion, exportedAt,
      data: includeImages ? data : withoutImageData(data) };
  };
  /** @param {BackupData} data */
  const toStorage = (data) => ({ laterOnItems: data.items, laterOnProjects: data.projects, laterOnCovers: data.covers,
    laterOnOrder: data.order, laterOnReadingPositions: data.readingPositions });
  /** @param {BackupData} data */
  const counts = (data) => ({ items: data.items.length, projects: data.projects.length, covers: Object.keys(data.covers).length, positions: Object.keys(data.readingPositions).length });

  // Existing URL matches retain their metadata/project/progress. Colliding IDs
  // receive new IDs; every imported reference follows those mappings.
  /**
   * @param {BackupData} current @param {BackupData} incoming
   * @param {(url:string)=>string} normalizeUrl @param {()=>string} newId
   * @returns {{data:BackupData, added:number, duplicates:number, addedProjects:number}}
   */
  function merge(current, incoming, normalizeUrl, newId) {
    const usedProjects = new Set(current.projects.map((entry) => entry.id));
    const usedItems = new Set(current.items.map((entry) => entry.id));
    const projectMap = new Map();
    const projectById = new Map(current.projects.map((entry) => [entry.id, entry]));
    const allocate = (used, preferred) => {
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
    const itemMap = new Map();
    const addedIds = new Set();
    const acceptedSources = new Set();
    const newItems = incoming.items.flatMap((item) => {
      const url = normalizeUrl(item.url);
      if (byUrl.has(url)) { itemMap.set(item.id, byUrl.get(url)); return []; }
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
      ...(project.coverPick ? { coverPick: [...new Set(project.coverPick.map((key) => itemMap.get(key)))].filter((key) => itemById.get(key)?.projectId === project.id) } : {}) }))];
    const remapDictionary = (entries) => Object.fromEntries(Object.entries(entries).flatMap(([key, value]) =>
      acceptedSources.has(key) ? [[itemMap.get(key), value]] : []));
    const order = { ...current.order };
    for (const [scope, entries] of Object.entries(incoming.order)) {
      const target = ["all", "unfiled"].includes(scope) ? scope : projectMap.get(scope);
      const mapped = entries.map((key) => itemMap.get(key)).filter((key) => {
        const item = itemById.get(key);
        return addedIds.has(key) && (target === "all" || (target === "unfiled" ? !item.projectId : item.projectId === target));
      });
      order[target] = [...new Set([...(order[target] || []), ...mapped])];
    }
    const data = validateData({ items, projects, covers: { ...current.covers, ...remapDictionary(incoming.covers) },
      order, readingPositions: { ...current.readingPositions, ...remapDictionary(incoming.readingPositions) } });
    return { data, added: newItems.length, duplicates: incoming.items.length - newItems.length, addedProjects: newProjects.length };
  }

  globalThis.LaterOnBackup = { FORMAT, VERSION, MAX_BYTES, parse, create, fromStorage, toStorage, counts, merge };
})();
