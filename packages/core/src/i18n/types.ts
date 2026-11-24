export const SUPPORTED_LOCALES = ["pt-BR", "en", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";

export const LOCALE_STORAGE_KEY = "bodhi-locale";

export interface LocaleMeta {
  code: Locale;
  shortLabel: string;
  nativeLabel: string;
  intlTag: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  "pt-BR": {
    code: "pt-BR",
    shortLabel: "PT",
    nativeLabel: "Português",
    intlTag: "pt-BR",
  },
  en: {
    code: "en",
    shortLabel: "EN",
    nativeLabel: "English",
    intlTag: "en-US",
  },
  es: {
    code: "es",
    shortLabel: "ES",
    nativeLabel: "Español",
    intlTag: "es-ES",
  },
};
