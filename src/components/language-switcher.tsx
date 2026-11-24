"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { LocaleFlag } from "@/components/locale-flag";
import { LOCALE_META, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/types";

export function LanguageSwitcher() {
  const { locale, setLocale, m } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={m.common.switchLanguage}
        aria-haspopup="menu"
        aria-expanded={open}
        data-locale={locale}
        title={`${m.common.switchLanguage} (${LOCALE_META[locale].nativeLabel})`}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
      >
        <LocaleFlag locale={locale} className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={m.common.switchLanguage}
          className="absolute top-full right-0 z-40 mt-2 w-40 rounded-2xl border border-black/8 bg-[var(--surface)] p-1.5 shadow-lg dark:border-white/12"
        >
          {SUPPORTED_LOCALES.map((code) => {
            const meta = LOCALE_META[code];
            const isActive = code === locale;

            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => handleSelect(code)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--surface-muted)] text-[var(--foreground)]"
                    : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]/60 hover:text-[var(--foreground)]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <LocaleFlag locale={code} className="h-4.5 w-4.5" />
                  <span>{meta.nativeLabel}</span>
                </span>
                {isActive && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
