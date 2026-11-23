"use client";

import { Check, Loader2 } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

interface EarlyFinishCardProps {
  title?: string;
  subtitle: string;
  noteValue: string;
  isSaving: boolean;
  onChangeNote: (value: string) => void;
  onDiscard: () => void;
  onSave: () => void;
  onResume?: () => void;
}

export function EarlyFinishCard({
  title,
  subtitle,
  noteValue,
  isSaving,
  onChangeNote,
  onDiscard,
  onSave,
  onResume,
}: EarlyFinishCardProps) {
  const { m } = useI18n();

  return (
    <div className="w-full rounded-2xl border border-black/8 bg-[var(--surface)] p-4 text-left shadow-xs dark:border-white/10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {title ?? m.timer.savePartialTitle}
          </p>
          <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
            {subtitle}
          </p>
        </div>

        {onResume && (
          <button
            type="button"
            onClick={onResume}
            disabled={isSaving}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-40"
          >
            {m.timer.keepPracticing}
          </button>
        )}
      </div>

      <textarea
        rows={2}
        maxLength={500}
        placeholder={m.timer.optionalNotePlaceholder}
        value={noteValue}
        onChange={(event) => onChangeNote(event.target.value)}
        className="mt-2.5 w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={isSaving}
          className="flex h-10 items-center justify-center rounded-xl border border-black/8 bg-[var(--background)] text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
        >
          {m.timer.discard}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {m.timer.saveSession}
        </button>
      </div>
    </div>
  );
}
