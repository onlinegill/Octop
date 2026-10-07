export type UiLocale = "zh" | "en";

export const UI_LOCALE_STORAGE_KEY = "octop:ui-locale";

/**
 * Map browser language tags to a supported dashboard locale.
 *
 * English-only fork: the dashboard ships a single locale, so detection always
 * resolves to ``en`` regardless of the browser's preferred languages.
 */
export function detectBrowserLocale(): UiLocale {
  return "en";
}

export function normalizeUiLocale(_raw: string | null | undefined): UiLocale {
  return "en";
}

export function readStoredUiLocale(): UiLocale | null {
  try {
    const raw = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (raw === "en") return raw;
  } catch {
    // localStorage unavailable
  }
  return null;
}

export function storeUiLocale(_locale: UiLocale): void {
  try {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en");
  } catch {
    // quota / disabled
  }
}

/** Stored user preference wins; otherwise fall back to English. */
export function resolveInitialLocale(): UiLocale {
  return readStoredUiLocale() ?? detectBrowserLocale();
}

export function syncDocumentLang(_locale: UiLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = "en";
}

/** BCP-47 tag for STT / SpeechRecognition from dashboard UI locale. */
export function speechLocaleFromUi(_locale: string | null | undefined): string {
  return "en-US";
}
