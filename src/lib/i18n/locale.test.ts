import { describe, expect, it } from "vitest";
import { getMessages, getNextLocale, isLocale, resolveLocale } from "./locale";
import { DEFAULT_LOCALE } from "./types";

describe("i18n locale utilities", () => {
  it("validates supported locales and falls back safely", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("es")).toBe(false);
    expect(isLocale(null)).toBe(false);

    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("cycles through supported locales", () => {
    expect(getNextLocale("en")).toBe("pt-BR");
    expect(getNextLocale("pt-BR")).toBe("en");
  });

  it("provides matching top-level message groups for en and pt-BR", () => {
    const en = getMessages("en");
    const pt = getMessages("pt-BR");

    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(pt.sounds.bells).sort()).toEqual(
      Object.keys(en.sounds.bells).sort()
    );
    expect(Object.keys(pt.sounds.ambient).sort()).toEqual(
      Object.keys(en.sounds.ambient).sort()
    );
    expect(pt.nav.history).toBe("Histórico");
    expect(en.nav.history).toBe("History");
  });
});
