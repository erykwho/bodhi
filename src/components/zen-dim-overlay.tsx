"use client";

import { useI18n } from "@/components/i18n-provider";

interface ZenDimOverlayProps {
  /** Primary muted text shown in the center (e.g. countdown time or track title). */
  primaryText: string;
  /** Optional secondary subtle caption (e.g. breathing phase label). */
  secondaryText?: string;
  /** Optional normalized breathing scale [0, 1] to render a whisper-soft OLED aura. */
  breathingScale?: number | null;
  /** Uses larger monospace display for timers. */
  monospace?: boolean;
  onWake: () => void;
}

export function ZenDimOverlay({
  primaryText,
  secondaryText,
  breathingScale = null,
  monospace = true,
  onWake,
}: ZenDimOverlayProps) {
  const { m } = useI18n();
  const haloScale =
    breathingScale !== null ? 0.72 + breathingScale * 0.42 : 1;

  return (
    <button
      type="button"
      onClick={onWake}
      aria-label={m.timer.wakeDimmedAria}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#050605] px-8 text-center focus:outline-none"
    >
      {breathingScale !== null && (
        <div
          aria-hidden="true"
          style={{ transform: `scale(${haloScale.toFixed(3)})` }}
          className="pointer-events-none absolute h-44 w-44 rounded-full border border-[var(--accent)]/15 bg-[var(--accent)]/6 transition-transform duration-150 ease-linear"
        />
      )}

      <span
        className={
          monospace
            ? "font-mono text-4xl font-normal tracking-tight text-white/25 tabular-nums"
            : "line-clamp-2 max-w-xs text-sm font-medium text-white/25"
        }
      >
        {primaryText}
      </span>

      {secondaryText && (
        <span className="text-xs font-medium tracking-wide text-white/20">
          {secondaryText}
        </span>
      )}

      <span className="text-[11px] tracking-wide text-white/15">
        {m.timer.tapToWake}
      </span>
    </button>
  );
}
