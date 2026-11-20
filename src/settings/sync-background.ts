import { BACKUP_STATE, DEFAULT_BACKUP_OPTIONS, normalizeBackupOptions } from "../backup/webdav-shared";
import { isRecord } from "../storage/contracts";
import { KEY, SYNC_APPLIED } from "./shared";
import * as settings from "./store";
import { localPreference, PREFERENCE_KEYS, PRESET_KEY, preferenceStorageKey, readPreference, selectPreset, SYNC_MESSAGE, SYNC_STATE } from "./sync-shared";
import type { PreferenceKey, PreferencePreview, SyncField, SyncState, SyncStatus, WebdavPreset } from "./sync-shared";

const defaults: SyncState = { enabled: false, sharePreset: false, failed: [] };

async function getState(): Promise<SyncState> {
  const stored = await chrome.storage.local.get<{ [SYNC_STATE]?: SyncState }>(SYNC_STATE);
  return stored[SYNC_STATE] ?? defaults;
}

function saveState(state: SyncState): Promise<void> {
  return chrome.storage.local.set({ [SYNC_STATE]: state });
}

export async function sharesWebdavPreset(): Promise<boolean> {
  const state = await getState();
  return state.enabled && state.sharePreset;
}

function readPreset(value: unknown): WebdavPreset | undefined {
  if (!isRecord(value) || typeof value.endpoint !== "string" || typeof value.directory !== "string" ||
    typeof value.username !== "string" || typeof value.intervalHours !== "number" || typeof value.includeImages !== "boolean") return;
  try { return selectPreset(normalizeBackupOptions({ ...DEFAULT_BACKUP_OPTIONS,
    endpoint: value.endpoint, directory: value.directory, username: value.username,
    intervalHours: value.intervalHours, includeImages: value.includeImages
  })); }
  catch { return undefined; }
}

async function currentPreset(): Promise<WebdavPreset | undefined> {
  const stored = await chrome.storage.local.get<{ [BACKUP_STATE]?: { settings?: unknown } }>(BACKUP_STATE);
  return readPreset(stored[BACKUP_STATE]?.settings);
}

async function showStatus(state: SyncState): Promise<SyncStatus> {
  if (!state.enabled || !state.sharePreset) return state;
  try {
    const values = await chrome.storage.sync.get(PRESET_KEY);
    const preset = readPreset(values[PRESET_KEY]);
    return preset ? { ...state, preset } : state;
  } catch { return { ...state, unavailable: true }; }
}

async function publish(state: SyncState, fields: readonly SyncField[], values: Readonly<Record<string, unknown>>): Promise<SyncState> {
  if (!fields.length) return state;
  let failed = state.failed.filter(field => !fields.includes(field));
  try { await chrome.storage.sync.set(values); }
  catch { failed = [...failed, ...fields]; }
  if (failed.length === state.failed.length && failed.every(field => state.failed.includes(field))) return state;
  const updated = { ...state, failed };
  await saveState(updated);
  return updated;
}

function preferenceWrites(keys: readonly PreferenceKey[], values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(keys.map(key => [preferenceStorageKey(key), localPreference(key, values)]));
}

async function enable(state: SyncState, message: Readonly<Record<string, unknown>>):
Promise<{ status: SyncStatus; preview?: PreferencePreview }> {
  if (state.enabled) return { status: await showStatus(state) };
  const values = await chrome.storage.sync.get(PREFERENCE_KEYS.map(preferenceStorageKey));
  const settingsNow = await settings.get();
  const local = PREFERENCE_KEYS.map(key => localPreference(key, settingsNow));
  const synced = PREFERENCE_KEYS.map(key => readPreference(key, values[preferenceStorageKey(key)]));
  const differences = PREFERENCE_KEYS.flatMap((key, index) => {
    const [before, after] = [local[index], synced[index]];
    return before !== undefined && after !== undefined && before !== after ? [{ key, local: before, synced: after }] : [];
  });
  const revision = JSON.stringify([local, synced]);
  const chooseLocal = message.choice === "local";
  const chooseSynced = message.choice === "synced";
  if (differences.length && (message.revision !== revision || (!chooseLocal && !chooseSynced))) {
    return { status: state, preview: { differences, revision } };
  }
  if (chooseSynced && differences.length) {
    await settings.set(Object.fromEntries(differences.map(({ key, synced }) => [key, synced])), "sync");
  }
  const updated = { ...state, enabled: true };
  await saveState(updated);
  // Missing fields keep their local values when the user adopts the stored preferences.
  const seed = (chooseLocal && differences.length > 0) || synced.every(value => value === undefined);
  return { status: seed ? await publish(updated, PREFERENCE_KEYS, preferenceWrites(PREFERENCE_KEYS, settingsNow)) : updated };
}

async function togglePreset(state: SyncState, enabled: boolean): Promise<SyncStatus> {
  if (!state.enabled || enabled === state.sharePreset) return showStatus(state);
  if (!enabled) {
    const updated = { ...state, sharePreset: false, failed: state.failed.filter(field => field !== "preset") };
    await saveState(updated);
    return updated;
  }
  const values = await chrome.storage.sync.get(PRESET_KEY);
  const preset = readPreset(values[PRESET_KEY]);
  const updated = { ...state, sharePreset: true };
  await saveState(updated);
  if (preset) return { ...updated, preset };
  const local = await currentPreset();
  return local ? showStatus(await publish(updated, ["preset"], { [PRESET_KEY]: local })) : updated;
}

async function retry(state: SyncState): Promise<SyncStatus> {
  if (!state.enabled || !state.failed.length) return showStatus(state);
  const fields = PREFERENCE_KEYS.filter(key => state.failed.includes(key));
  const preset = state.sharePreset && state.failed.includes("preset") ? await currentPreset() : undefined;
  const values = { ...preferenceWrites(fields, await settings.get()), ...(preset ? { [PRESET_KEY]: preset } : {}) };
  return showStatus(await publish(state, preset ? [...fields, "preset"] : fields, values));
}

export function registerConfigurationSync(): (preset: WebdavPreset) => Promise<void> {
  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  }

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[KEY] && !changes[SYNC_APPLIED]) {
      const { oldValue, newValue } = changes[KEY];
      const before = isRecord(oldValue) ? oldValue : {};
      if (!isRecord(newValue)) return;
      const fields = PREFERENCE_KEYS.filter(key => localPreference(key, before) !== localPreference(key, newValue));
      if (fields.length) void serialize(async () => {
        const state = await getState();
        if (state.enabled) await publish(state, fields, preferenceWrites(fields, newValue));
      }).catch(() => {});
    }
    if (area !== "sync") return;
    const fields = PREFERENCE_KEYS.filter(key => changes[preferenceStorageKey(key)]);
    if (!fields.length) return;
    void serialize(async () => {
      const state = await getState();
      if (!state.enabled) return;
      const values = await chrome.storage.sync.get(fields.map(preferenceStorageKey));
      const patch = fields.flatMap(key => {
        const value = readPreference(key, values[preferenceStorageKey(key)]);
        // Keep unsent local edits available for the explicit retry.
        return value === undefined || state.failed.includes(key) ? [] : [[key, value]];
      });
      if (patch.length) await settings.set(Object.fromEntries(patch), "sync");
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== SYNC_MESSAGE) return;
    if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return;
    serialize(async () => {
      const state = await getState();
      if (message.action === "enable") return enable(state, message);
      if (message.action === "disable") { await saveState(defaults); return { status: defaults }; }
      if (message.action === "preset") return { status: await togglePreset(state, message.enabled === true) };
      if (message.action === "retry") return { status: await retry(state) };
      return { status: await showStatus(state) };
    }).then(result => respond({ ok: true, ...result }), () => respond({ ok: false }));
    return true;
  });

  return preset => serialize(async () => {
    const state = await getState();
    if (state.enabled && state.sharePreset) await publish(state, ["preset"], { [PRESET_KEY]: selectPreset(preset) });
  });
}
