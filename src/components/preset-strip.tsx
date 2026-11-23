"use client";

import { useCallback, useState } from "react";
import { Bookmark, Check, Loader2, Plus, X } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import {
  MAX_PRESET_NAME_LENGTH,
  MAX_TIMER_PRESETS,
  doesPresetMatchPreferences,
  formatPresetSummary,
  sanitizePresetName,
  type TimerPresetItem,
} from "@/lib/timer/presets";
import type { TimerPreferences } from "@/lib/timer/types";

interface PresetStripProps {
  presets: TimerPresetItem[];
  currentPreferences: TimerPreferences;
  isSaving?: boolean;
  onApply: (preset: TimerPresetItem) => void;
  onCreate: (name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}

export function PresetStrip({
  presets,
  currentPreferences,
  isSaving = false,
  onApply,
  onCreate,
  onDelete,
}: PresetStripProps) {
  const { m } = useI18n();
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canCreateMore = presets.length < MAX_TIMER_PRESETS;

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const cleaned = sanitizePresetName(nameDraft);
      if (!cleaned) return;
      const ok = await onCreate(cleaned);
      if (ok) {
        setNameDraft("");
        setIsCreating(false);
      }
    },
    [nameDraft, onCreate]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await onDelete(id);
      } finally {
        setDeletingId(null);
      }
    },
    [onDelete]
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Compact single-row horizontal scroll strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {presets.map((preset) => {
          const isMatch = doesPresetMatchPreferences(
            preset,
            currentPreferences
          );
          const isDeleting = deletingId === preset.id;

          return (
            <div
              key={preset.id}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border pl-2.5 pr-1.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                isMatch
                  ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-black/6 bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
              }`}
            >
              <button
                type="button"
                onClick={() => onApply(preset)}
                title={formatPresetSummary(preset.preferences)}
                className="inline-flex items-center gap-1.5 pr-1"
              >
                <Bookmark className="h-3 w-3 shrink-0 opacity-75" />
                <span>{preset.name}</span>
                <span className="text-[10px] opacity-70 tabular-nums">
                  {preset.preferences.openEnded
                    ? "∞"
                    : `${preset.preferences.durationMinutes}m`}
                </span>
              </button>

              {isEditing && (
                <button
                  type="button"
                  onClick={() => void handleDelete(preset.id)}
                  disabled={isDeleting}
                  aria-label={m.presets.deletePresetAria(preset.name)}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
                >
                  {isDeleting ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <X className="h-2.5 w-2.5" />
                  )}
                </button>
              )}
            </div>
          );
        })}

        {canCreateMore && !isCreating && (
          <button
            type="button"
            onClick={() => {
              setIsEditing(false);
              setIsCreating(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-black/15 bg-transparent px-2.5 py-1 text-xs font-medium text-[var(--foreground-muted)] whitespace-nowrap transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--foreground)] dark:border-white/15"
          >
            <Plus className="h-3 w-3" />
            {m.presets.savePreset}
          </button>
        )}

        {presets.length > 0 && !isCreating && (
          <button
            type="button"
            onClick={() => setIsEditing((prev) => !prev)}
            className="ml-auto shrink-0 px-1.5 py-1 text-[11px] font-medium text-[var(--foreground-muted)] whitespace-nowrap transition-colors hover:text-[var(--foreground)]"
          >
            {isEditing ? m.common.done : m.common.edit}
          </button>
        )}
      </div>

      {/* Inline Save Preset Form */}
      {isCreating && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] p-2 shadow-xs dark:border-white/10"
        >
          <input
            type="text"
            autoFocus
            required
            maxLength={MAX_PRESET_NAME_LENGTH}
            placeholder={m.presets.placeholder}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70"
          />
          <button
            type="button"
            onClick={() => {
              setIsCreating(false);
              setNameDraft("");
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
            aria-label={m.presets.cancelSavingAria}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="submit"
            disabled={isSaving || !sanitizePresetName(nameDraft)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[#fcfaf6] disabled:opacity-45 dark:text-[#151917]"
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            {m.common.save}
          </button>
        </form>
      )}
    </div>
  );
}
