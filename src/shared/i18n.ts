import { setLanguage as updateLanguage } from "./i18n-runtime";
export { t, ready, getLanguage, applyStatic } from "./i18n-runtime";
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (key: string, values?: TranslationValues) => string;

export async function setLanguage(language: "zh-CN" | "en"): Promise<void> {
  await updateLanguage(language);
  window.setTimeout(() => window.location.reload(), 0);
}
