import type { BackgroundSnapshot } from "../background/shared";
import type { ImportToken } from "./client";
import { isRecord } from "../storage/contracts";

interface BackupRequest {
  readonly payload?: unknown;
  readonly mode?: unknown;
  readonly token?: Partial<ImportToken>;
  readonly includeImages?: unknown;
}

import * as core from "./core";
import * as store from "../storage/coordinator";
import { normalize } from "../shared/url-utils";

export function registerBackup() {
  const snapshot = () => chrome.storage.local.get<BackgroundSnapshot>([...store.KEYS]);
  const fingerprint = async (value: unknown) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const validate = ({ payload, mode }: BackupRequest) => {
    if (mode !== "merge" && mode !== "replace") throw new Error("INVALID_IMPORT_MODE");
    if (new TextEncoder().encode(JSON.stringify(payload)).length > core.MAX_BYTES) throw new Error("BACKUP_TOO_LARGE");
    return core.parse(payload);
  };
  const plan = (current: core.BackupData, incoming: core.BackupData, mode: unknown) => mode === "replace"
    ? { data: incoming, added: incoming.items.length, duplicates: 0, addedProjects: incoming.projects.length }
    : core.merge(current, incoming, normalize, () => crypto.randomUUID());

  async function exportBackup({ includeImages }: BackupRequest) {
    return store.enqueue(async () => ({ ok: true, payload: core.create(await snapshot(), chrome.runtime.getManifest().version,
      new Date().toISOString(), { includeImages: includeImages === true }) }));
  }

  async function preview({ payload, mode }: BackupRequest) {
    const incoming = validate({ payload, mode });
    return store.enqueue(async () => {
      const base = await snapshot();
      const current = core.fromStorage(base);
      const result = plan(current, incoming, mode);
      // The UI retains the file and this revision. No in-memory preview session:
      // MV3 can stop the worker while the user is reading the confirmation.
      const token = { revision: await fingerprint(base), createdAt: Date.now() };
      return { ok: true, token, incoming: core.counts(incoming), current: core.counts(current),
        added: result.added, duplicates: result.duplicates, addedProjects: result.addedProjects, exportedAt: isRecord(payload) ? payload.exportedAt : undefined };
    });
  }

  async function apply({ token, payload, mode }: BackupRequest) {
    if (!token || typeof token.revision !== "string" || token.createdAt === undefined || !/^[a-f0-9]{64}$/.test(token.revision) || !Number.isFinite(token.createdAt)
      || token.createdAt > Date.now() || token.createdAt < Date.now() - 10 * 60 * 1000) throw new Error("IMPORT_PREVIEW_EXPIRED");
    const incoming = validate({ payload, mode });
    return store.enqueue(async () => {
      const latest = await snapshot();
      if (mode === "replace" && await fingerprint(latest) !== token.revision) throw new Error("IMPORT_DATA_CHANGED");
      const current = core.fromStorage(latest);
      const result = plan(current, incoming, mode);
      const epoch = crypto.randomUUID();
      // A single storage write commits all references and invalidates old pages.
      await chrome.storage.local.set({ ...core.toStorage(result.data), [store.EPOCH]: epoch,
        laterOnCurrentItem: null, laterOnActiveProject: "all" });
      return { ok: true, added: result.added, duplicates: result.duplicates, addedProjects: result.addedProjects, total: result.data.items.length };
    });
  }

  async function wipe() {
    return store.enqueue(async () => {
      const stored = await chrome.storage.local.get<BackgroundSnapshot>("laterOnProjects");
      const projects = (stored.laterOnProjects || []).map(({ coverPick, ...project }) => project);
      await chrome.storage.local.set({ laterOnItems: [], laterOnCovers: {}, laterOnOrder: {}, laterOnReadingPositions: {},
        laterOnProjects: projects, laterOnCurrentItem: null, [store.EPOCH]: crypto.randomUUID() });
      return { ok: true };
    });
  }

  const handlers = new Map<string, (request: BackupRequest) => Promise<object>>([
    ["BACKUP_EXPORT", exportBackup], ["BACKUP_PREVIEW", preview], ["BACKUP_APPLY", apply], ["COLLECTION_WIPE", wipe]
  ]);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const handler = handlers.get(message?.type);
    if (!handler) return;
    if (sender?.tab && !String(sender.url || "").startsWith(chrome.runtime.getURL(""))) {
      respond({ ok: false, error: "INVALID_SENDER" });
      return;
    }
    handler(message).then(respond).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
}
