import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectBrowserLocale,
  normalizeUiLocale,
  readStoredUiLocale,
  resolveInitialLocale,
  speechLocaleFromUi,
  storeUiLocale,
  UI_LOCALE_STORAGE_KEY,
} from "./localePrefs";

/** Minimal in-memory Storage; Node's global localStorage is unavailable. */
function installMemoryStorage(): void {
  const map = new Map<string, string>();
  const storage: Storage = {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
  vi.stubGlobal("localStorage", storage);
}

describe("localePrefs", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detectBrowserLocale is English-only regardless of browser languages", () => {
    vi.stubGlobal("navigator", {
      language: "zh-CN",
      languages: ["zh-CN", "en-US"],
    });
    expect(detectBrowserLocale()).toBe("en");
  });

  it("normalizeUiLocale always resolves to English", () => {
    expect(normalizeUiLocale(null)).toBe("en");
    expect(normalizeUiLocale("zh")).toBe("en");
    expect(normalizeUiLocale("zh-CN")).toBe("en");
    expect(normalizeUiLocale("en-US")).toBe("en");
  });

  it("resolveInitialLocale stays English even with a stored/legacy preference", () => {
    vi.stubGlobal("navigator", {
      language: "zh-CN",
      languages: ["zh-CN"],
    });
    storeUiLocale("zh");
    expect(resolveInitialLocale()).toBe("en");
    expect(readStoredUiLocale()).toBe("en");
    globalThis.localStorage?.removeItem(UI_LOCALE_STORAGE_KEY);
    expect(resolveInitialLocale()).toBe("en");
  });

  it("speechLocaleFromUi maps every UI locale to the English STT tag", () => {
    expect(speechLocaleFromUi("zh")).toBe("en-US");
    expect(speechLocaleFromUi("zh-CN")).toBe("en-US");
    expect(speechLocaleFromUi("en")).toBe("en-US");
    expect(speechLocaleFromUi("en-US")).toBe("en-US");
    expect(speechLocaleFromUi(null)).toBe("en-US");
  });
});
