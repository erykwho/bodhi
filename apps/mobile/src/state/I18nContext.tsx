import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  getMessages,
  getNextLocale,
  LOCALE_META,
  type Locale,
  type Messages,
} from "@bodhi/core/i18n";
import { readStoredLocale, writeStoredLocale } from "../platform/storage";

interface I18nContextValue {
  locale: Locale;
  intlTag: string;
  m: Messages;
  setLocale: (next: Locale) => void;
  cycleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  const cycleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next = getNextLocale(prev);
      writeStoredLocale(next);
      return next;
    });
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      intlTag: LOCALE_META[locale].intlTag,
      m: getMessages(locale),
      setLocale,
      cycleLocale,
    }),
    [locale, setLocale, cycleLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useBodhiI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useBodhiI18n must be used within I18nProvider");
  }
  return ctx;
}
