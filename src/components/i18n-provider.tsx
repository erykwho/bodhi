"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { getMessages, getNextLocale, resolveLocale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages/en";
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/lib/i18n/types";

interface I18nContextValue {
  locale: Locale;
  intlTag: string;
  m: Messages;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function getClientLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    return resolveLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

function getServerLocale(): Locale {
  return DEFAULT_LOCALE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) {
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(
    subscribe,
    getClientLocale,
    getServerLocale
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage quota errors
    }
    document.documentElement.lang = next;
    emitChange();
  }, []);

  const toggleLocale = useCallback(() => {
    const next = getNextLocale(getClientLocale());
    setLocale(next);
  }, [setLocale]);

  const m = getMessages(locale);
  const intlTag = LOCALE_META[locale].intlTag;

  return (
    <I18nContext.Provider
      value={{ locale, intlTag, m, setLocale, toggleLocale }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
