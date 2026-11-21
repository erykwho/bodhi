export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "bodhi-locale";

export interface LocaleMeta {
  code: Locale;
  shortLabel: string;
  nativeLabel: string;
  intlTag: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: {
    code: "en",
    shortLabel: "EN",
    nativeLabel: "English",
    intlTag: "en-US",
  },
  "pt-BR": {
    code: "pt-BR",
    shortLabel: "PT",
    nativeLabel: "Português (Brasil)",
    intlTag: "pt-BR",
  },
};
