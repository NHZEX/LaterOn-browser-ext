import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { DEFAULTS, KEY, SYNC_APPLIED, resolveSettings } from "./shared";
import type { Settings, StoredSettings } from "./shared";

export { DEFAULTS, KEY };

// Notifications include raw storage values; unlike get(), they do not apply opt-in rules.
export type SettingsListener = (settings: Readonly<Record<string, unknown>>, previous: unknown) => void;

export async function get(): Promise<Settings> {
  const stored = await browser.storage.local.get<{ [KEY]?: StoredSettings }>(KEY);
  return resolveSettings(stored[KEY] || {});
}

export async function set(patch: StoredSettings, source?: "sync"): Promise<void> {
  const write = async () => {
    const current = await get();
    const updated: Settings = {
      ...current,
      ...patch,
      ...(Object.prototype.hasOwnProperty.call(patch, "askFolderOnSingle") ? { askFolderOnSingleOptIn: true } : {})
    };
    if (Object.keys(patch).every(key => Object.is(updated[key], current[key])) &&
      updated.askFolderOnSingleOptIn === current.askFolderOnSingleOptIn) return;
    await browser.storage.local.set({ [KEY]: updated, ...(source === "sync" ? { [SYNC_APPLIED]: crypto.randomUUID() } : {}) });
  };
  // Pages and the worker both merge into the same local settings record.
  const locks = globalThis.navigator?.locks;
  if (locks) await locks.request(KEY, write);
  else await write();
}

export function watch(callback: SettingsListener): () => void {
  const changed = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area !== "local" || !changes[KEY]) return;
    // Preserve the existing notification payload: defaults plus the raw changed value.
    callback({ ...DEFAULTS, ...(changes[KEY].newValue || {}) }, changes[KEY].oldValue);
  };
  browser.storage.onChanged.addListener(changed);
  return () => browser.storage.onChanged.removeListener?.(changed);
}
