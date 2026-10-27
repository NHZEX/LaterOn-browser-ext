import type { Translate } from "./i18n";
export const dictionaries: Readonly<Record<"zh-CN" | "en", Readonly<Record<string, string>>>>;
export const t: Translate;
export const ready: Promise<void>;
export function getLanguage(): Promise<"zh-CN" | "en">;
export function setLanguage(language: "zh-CN" | "en"): Promise<"zh-CN" | "en">;
export function applyStatic(): void;
