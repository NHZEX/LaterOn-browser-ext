import "../../i18n.js";

export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (key: string, values?: TranslationValues) => string;

declare global {
  var LaterOnI18n: {
    readonly t: Translate;
    readonly ready: Promise<void>;
    getLanguage(): Promise<"zh-CN" | "en">;
    setLanguage(language: "zh-CN" | "en"): Promise<"zh-CN" | "en">;
    applyStatic(): void;
  } | undefined;
}

// Reuse the existing dictionaries without letting applyStatic mutate Vue-owned nodes.
export const t: Translate = (key, values) => globalThis.LaterOnI18n?.t(key, values) ?? key;
export const ready = globalThis.LaterOnI18n?.ready ?? Promise.resolve();

export async function setLanguage(language: "zh-CN" | "en"): Promise<void> {
  await globalThis.LaterOnI18n?.setLanguage(language);
  window.setTimeout(() => window.location.reload(), 0);
}
