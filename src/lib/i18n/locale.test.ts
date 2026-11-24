import { describe, expect, it } from "vitest";
import { getMessages, getNextLocale, isLocale, resolveLocale } from "./locale";
import { DEFAULT_LOCALE, LOCALE_META, SUPPORTED_LOCALES } from "./types";

function collectLeafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      paths.push(...collectLeafPaths(value as Record<string, unknown>, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

function collectEmptyStrings(
  obj: Record<string, unknown>,
  prefix = ""
): string[] {
  const empty: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      if (value.trim().length === 0) empty.push(path);
    } else if (Array.isArray(value)) {
      if (value.length === 0) empty.push(path);
    } else if (value !== null && typeof value === "object") {
      empty.push(...collectEmptyStrings(value as Record<string, unknown>, path));
    }
  }
  return empty;
}

describe("i18n locale utilities", () => {
  it("defaults to Brazilian Portuguese (pt-BR)", () => {
    expect(DEFAULT_LOCALE).toBe("pt-BR");
    expect(SUPPORTED_LOCALES).toEqual(["pt-BR", "en", "es"]);
  });

  it("validates supported locales and falls back safely", () => {
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);

    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("fr")).toBe("pt-BR");
    expect(resolveLocale(undefined)).toBe("pt-BR");
  });

  it("cycles through all supported locales", () => {
    expect(getNextLocale("pt-BR")).toBe("en");
    expect(getNextLocale("en")).toBe("es");
    expect(getNextLocale("es")).toBe("pt-BR");
  });

  it("provides valid metadata for every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const meta = LOCALE_META[locale];
      expect(meta.code).toBe(locale);
      expect(meta.nativeLabel.trim().length).toBeGreaterThan(0);
      expect(meta.intlTag.trim().length).toBeGreaterThan(0);
    }
  });

  it("maintains 100% recursive key parity and non-empty values across en, pt-BR, and es", () => {
    const en = getMessages("en");
    const pt = getMessages("pt-BR");
    const es = getMessages("es");

    const enPaths = collectLeafPaths(en as unknown as Record<string, unknown>);
    const ptPaths = collectLeafPaths(pt as unknown as Record<string, unknown>);
    const esPaths = collectLeafPaths(es as unknown as Record<string, unknown>);

    expect(ptPaths).toEqual(enPaths);
    expect(esPaths).toEqual(enPaths);

    expect(
      collectEmptyStrings(en as unknown as Record<string, unknown>)
    ).toEqual([]);
    expect(
      collectEmptyStrings(pt as unknown as Record<string, unknown>)
    ).toEqual([]);
    expect(
      collectEmptyStrings(es as unknown as Record<string, unknown>)
    ).toEqual([]);

    expect(pt.nav.history).toBe("Histórico");
    expect(en.nav.history).toBe("History");
    expect(es.nav.history).toBe("Historial");
    expect(es.history.calendar.weekdays).toHaveLength(7);
  });
});
