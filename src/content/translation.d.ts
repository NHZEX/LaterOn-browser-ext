export type TranslationResult =
  | { readonly ok: true; readonly translatedCount: number; readonly sourceLanguage: string }
  | { readonly ok: true; readonly removed: true }
  | { readonly ok: false; readonly error: string };

export function togglePageTranslation(): Promise<TranslationResult>;
