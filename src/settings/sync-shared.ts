import { DEFAULTS } from "./shared";
import type { Settings } from "./shared";
import type { BackupOptions } from "../backup/webdav-shared";

export const SYNC_MESSAGE = "CONFIGURATION_SYNC";
export const SYNC_STATE = "laterOnConfigurationSync";
export const PRESET_KEY = "stayside.webdav-preset";
export const PREFERENCE_KEYS = ["theme", "language", "defaultSort"] as const;

export type PreferenceKey = typeof PREFERENCE_KEYS[number];
export type Preferences = Pick<Settings, PreferenceKey>;
export type WebdavPreset = Pick<BackupOptions, "endpoint" | "directory" | "username" | "intervalHours" | "includeImages">;
export type SyncField = PreferenceKey | "preset";

export interface SyncState {
  readonly enabled: boolean;
  readonly sharePreset: boolean;
  readonly failed: readonly SyncField[];
}

export interface SyncStatus extends SyncState {
  readonly preset?: WebdavPreset;
  readonly unavailable?: boolean;
}

export interface PreferenceDifference {
  readonly key: PreferenceKey;
  readonly local: Preferences[PreferenceKey];
  readonly synced: Preferences[PreferenceKey];
}

export interface PreferencePreview {
  readonly differences: readonly PreferenceDifference[];
  readonly revision: string;
}

export type SyncReply = { readonly ok: false } | {
  readonly ok: true;
  readonly status: SyncStatus;
  readonly preview?: PreferencePreview;
};

const validValues: { readonly [K in PreferenceKey]: readonly Preferences[K][] } = {
  theme: ["system", "light", "dark"], language: ["zh-CN", "en"], defaultSort: ["newest", "oldest", "source", "custom"]
};

export function preferenceStorageKey(key: PreferenceKey): string { return `stayside.preference.${key}`; }

export function readPreference<K extends PreferenceKey>(key: K, value: unknown): Preferences[K] | undefined {
  return validValues[key].find(candidate => candidate === value);
}

export function localPreference<K extends PreferenceKey>(key: K, values: Readonly<Record<string, unknown>>): Preferences[K] {
  return readPreference(key, values[key]) ?? DEFAULTS[key];
}

export function selectPreset({ endpoint, directory, username, intervalHours, includeImages }: WebdavPreset): WebdavPreset {
  return { endpoint, directory, username, intervalHours, includeImages };
}
