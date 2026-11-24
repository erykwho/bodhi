import { enMessages, type Messages } from "./messages/en";
import { esMessages } from "./messages/es";
import { ptBrMessages } from "./messages/pt-br";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "./types";

const MESSAGES_BY_LOCALE: Record<Locale, Messages> = {
  "pt-BR": ptBrMessages,
  en: enMessages,
  es: esMessages,
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function resolveLocale(stored: unknown): Locale {
  if (isLocale(stored)) return stored;
  return DEFAULT_LOCALE;
}

export function getNextLocale(current: Locale): Locale {
  const index = SUPPORTED_LOCALES.indexOf(current);
  if (index === -1) return DEFAULT_LOCALE;
  return SUPPORTED_LOCALES[(index + 1) % SUPPORTED_LOCALES.length];
}

export function getMessages(locale: Locale): Messages {
  return MESSAGES_BY_LOCALE[locale] ?? MESSAGES_BY_LOCALE[DEFAULT_LOCALE];
}
