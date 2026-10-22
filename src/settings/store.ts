import { browser } from "wxt/browser";
import { DEFAULTS, KEY, resolveSettings } from "./shared";
import type { Settings, StoredSettings } from "./shared";

export { DEFAULTS, KEY };

// Notifications include raw storage values; unlike get(), they do not apply opt-in rules.
export type SettingsListener = (settings: Readonly<Record<string, unknown>>, previous: unknown) => void;

export async function get(): Promise<Settings> {
  const stored = await browser.storage.local.get<{ [KEY]?: StoredSettings }>(KEY);
  return resolveSettings(stored[KEY] || {});
}

export async function set(patch: StoredSettings): Promise<void> {
  const current = await get();
  await browser.storage.local.set({
    [KEY]: {
      ...current,
      ...patch,
      ...(Object.prototype.hasOwnProperty.call(patch, "askFolderOnSingle") ? { askFolderOnSingleOptIn: true } : {})
    }
  });
}

export function watch(callback: SettingsListener): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    // Preserve the existing notification payload: defaults plus the raw changed value.
    callback({ ...DEFAULTS, ...(changes[KEY].newValue || {}) }, changes[KEY].oldValue);
  });
}
