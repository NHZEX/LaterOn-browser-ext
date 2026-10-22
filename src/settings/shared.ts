export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

export interface Settings {
  readonly theme: Theme;
  readonly defaultSort: "newest" | "oldest" | "source" | "custom";
  readonly autoMarkRead: boolean;
  readonly askFolderOnBatch: boolean;
  readonly askFolderOnSingle: boolean;
  readonly askFolderOnSingleOptIn: boolean;
  readonly autoCleanDays: number;
  readonly language: "zh-CN" | "en";
  // Other pages also persist preferences (for example libraryView) under this key.
  readonly [key: string]: unknown;
}

export type StoredSettings = Partial<Settings>;

export const KEY = "laterOnSettings";
export const DEFAULTS: Settings = {
  theme: "light",
  defaultSort: "newest",
  autoMarkRead: true,
  askFolderOnBatch: true,
  askFolderOnSingle: false,
  // A legacy true value alone does not count as an explicit opt-in.
  askFolderOnSingleOptIn: false,
  autoCleanDays: 30,
  language: "zh-CN"
};

export function resolveSettings(stored: StoredSettings = {}): Settings {
  return {
    ...DEFAULTS,
    ...stored,
    ...(stored.askFolderOnSingleOptIn !== true ? { askFolderOnSingle: false } : {})
  };
}

export function resolveTheme(theme: unknown, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme === "dark" ? "dark" : "light";
}
