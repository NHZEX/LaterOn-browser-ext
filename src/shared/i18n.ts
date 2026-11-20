import { shallowRef } from "vue";
import { t as translate } from "./i18n-runtime";
export { ready, getLanguage, applyStatic, applyLanguage } from "./i18n-runtime";
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (key: string, values?: TranslationValues) => string;

const languageRevision = shallowRef(0);
window.addEventListener("lateron-language-change", () => { languageRevision.value++; });

export function t(key: string, values?: TranslationValues): string {
  void languageRevision.value;
  return translate(key, values);
}
