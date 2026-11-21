"use client";

import { useEffect } from "react";
import {
  Check,
  Minus,
  Play,
  Plus,
  Square,
  Volume2,
  X,
} from "lucide-react";
import {
  AMBIENT_SOUNDS,
  BELL_SOUNDS,
  type AmbientSoundId,
  type BellSoundId,
} from "@/lib/audio/sounds";
import { computeIntervalCount } from "@/lib/timer/engine";
import {
  INTERVAL_PRESETS_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
} from "@/lib/timer/types";

export type SoundSheetSlot = "start" | "interval" | "end" | "background";

interface SoundPickerSheetProps {
  slot: SoundSheetSlot | null;
  durationMinutes: number;
  startBell: BellSoundId;
  endBell: BellSoundId;
  intervalEnabled: boolean;
  intervalMinutes: number;
  intervalBell: BellSoundId;
  ambientSound: AmbientSoundId;
  ambientVolume: number;
  previewingAmbientId: AmbientSoundId | null;
  onClose: () => void;
  onSelectStartBell: (id: BellSoundId) => void;
  onSelectEndBell: (id: BellSoundId) => void;
  onToggleIntervalEnabled: (enabled: boolean) => void;
  onChangeIntervalMinutes: (minutes: number) => void;
  onSelectIntervalBell: (id: BellSoundId) => void;
  onSelectAmbientSound: (id: AmbientSoundId) => void;
  onChangeAmbientVolume: (volume: number) => void;
  onPreviewBell: (id: BellSoundId) => void;
  onTogglePreviewAmbient: (id: AmbientSoundId) => void;
}

const SHEET_META: Record<
  SoundSheetSlot,
  { title: string; subtitle: string }
> = {
  start: {
    title: "Opening Sound",
    subtitle: "Chime played when your meditation begins",
  },
  interval: {
    title: "Interval Sound",
    subtitle: "Gentle repeating cue during your session",
  },
  end: {
    title: "Closing Sound",
    subtitle: "Chime played when your session completes",
  },
  background: {
    title: "Background Sound",
    subtitle: "Continuous ambient soundscape while meditating",
  },
};

const INTERVAL_BELL_OPTIONS = BELL_SOUNDS.filter(
  (sound) => sound.kind !== "none"
);

export function SoundPickerSheet({
  slot,
  durationMinutes,
  startBell,
  endBell,
  intervalEnabled,
  intervalMinutes,
  intervalBell,
  ambientSound,
  ambientVolume,
  previewingAmbientId,
  onClose,
  onSelectStartBell,
  onSelectEndBell,
  onToggleIntervalEnabled,
  onChangeIntervalMinutes,
  onSelectIntervalBell,
  onSelectAmbientSound,
  onChangeAmbientVolume,
  onPreviewBell,
  onTogglePreviewAmbient,
}: SoundPickerSheetProps) {
  useEffect(() => {
    if (!slot) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, slot]);

  if (!slot) return null;

  const meta = SHEET_META[slot];
  const intervalChimeCount = computeIntervalCount(
    durationMinutes,
    intervalMinutes
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82dvh] w-full max-w-md flex-col rounded-t-3xl border border-black/8 bg-[var(--surface)] shadow-xl dark:border-white/10 sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {meta.title}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
              {meta.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sound picker"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {(slot === "start" || slot === "end") && (
            <div className="flex flex-col gap-2">
              {BELL_SOUNDS.map((sound) => {
                const selectedId = slot === "start" ? startBell : endBell;
                const isSelected = selectedId === sound.id;
                const handleSelect = () => {
                  if (slot === "start") {
                    onSelectStartBell(sound.id);
                  } else {
                    onSelectEndBell(sound.id);
                  }
                };

                return (
                  <div
                    key={sound.id}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                      isSelected
                        ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                        : "border-black/5 bg-[var(--background)]/60 dark:border-white/8"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={handleSelect}
                      className="flex flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          isSelected
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                            : "border-black/20 dark:border-white/25"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--foreground)]">
                          {sound.name}
                        </span>
                        <span className="block truncate text-xs text-[var(--foreground-muted)]">
                          {sound.description}
                        </span>
                      </span>
                    </button>

                    {sound.kind !== "none" && (
                      <button
                        type="button"
                        onClick={() => onPreviewBell(sound.id)}
                        aria-label={`Preview ${sound.name}`}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        Preview
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {slot === "interval" && (
            <div className="flex flex-col gap-4">
              {/* Enable / Disable Toggle */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-black/6 bg-[var(--background)]/60 px-3.5 py-3 dark:border-white/8">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Repeat interval cue
                  </p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    {intervalEnabled
                      ? intervalChimeCount > 0
                        ? `Plays ${intervalChimeCount}× during ${durationMinutes}m session`
                        : `No chimes fit in a ${durationMinutes}m session`
                      : "Disabled by default"}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={intervalEnabled}
                  aria-label="Enable interval sound"
                  onClick={() => onToggleIntervalEnabled(!intervalEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    intervalEnabled
                      ? "bg-[var(--accent)]"
                      : "bg-black/15 dark:bg-white/20"
                  }`}
                >
                  <span
                    className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-xs transition-transform ${
                      intervalEnabled ? "translate-x-5.5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {intervalEnabled && (
                <>
                  {/* Interval Duration Presets & Fine Stepper */}
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--foreground-muted)]">
                        Repeat every
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeIntervalMinutes(intervalMinutes - 1)
                          }
                          disabled={intervalMinutes <= MIN_INTERVAL_MINUTES}
                          aria-label="Decrease interval by 1 minute"
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-[3.5rem] text-center text-xs font-semibold text-[var(--foreground)] tabular-nums">
                          {intervalMinutes} min
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onChangeIntervalMinutes(intervalMinutes + 1)
                          }
                          disabled={intervalMinutes >= MAX_INTERVAL_MINUTES}
                          aria-label="Increase interval by 1 minute"
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5">
                      {INTERVAL_PRESETS_MINUTES.map((preset) => {
                        const isSelected = intervalMinutes === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => onChangeIntervalMinutes(preset)}
                            className={`h-9 rounded-xl text-xs font-medium whitespace-nowrap tabular-nums transition-colors ${
                              isSelected
                                ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                                : "border border-black/6 bg-[var(--background)]/70 text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                            }`}
                          >
                            {preset}m
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interval Sound Choices */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-[var(--foreground-muted)]">
                      Interval chime
                    </span>
                    {INTERVAL_BELL_OPTIONS.map((sound) => {
                      const isSelected = intervalBell === sound.id;
                      return (
                        <div
                          key={sound.id}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                            isSelected
                              ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                              : "border-black/5 bg-[var(--background)]/60 dark:border-white/8"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectIntervalBell(sound.id)}
                            className="flex flex-1 items-center gap-2.5 text-left"
                          >
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                isSelected
                                  ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                                  : "border-black/20 dark:border-white/25"
                              }`}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-[var(--foreground)]">
                                {sound.name}
                              </span>
                              <span className="block truncate text-xs text-[var(--foreground-muted)]">
                                {sound.description}
                              </span>
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onPreviewBell(sound.id)}
                            aria-label={`Preview ${sound.name}`}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Preview
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {slot === "background" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                {AMBIENT_SOUNDS.map((sound) => {
                  const isSelected = ambientSound === sound.id;
                  const isPreviewing = previewingAmbientId === sound.id;

                  return (
                    <div
                      key={sound.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                        isSelected
                          ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                          : "border-black/5 bg-[var(--background)]/60 dark:border-white/8"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectAmbientSound(sound.id)}
                        className="flex flex-1 items-center gap-2.5 text-left"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            isSelected
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                              : "border-black/20 dark:border-white/25"
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--foreground)]">
                            {sound.name}
                          </span>
                          <span className="block truncate text-xs text-[var(--foreground-muted)]">
                            {sound.description}
                          </span>
                        </span>
                      </button>

                      {sound.kind !== "none" && (
                        <button
                          type="button"
                          onClick={() => onTogglePreviewAmbient(sound.id)}
                          aria-label={
                            isPreviewing
                              ? `Stop ${sound.name} preview`
                              : `Preview ${sound.name}`
                          }
                          className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                            isPreviewing
                              ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                              : "bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          {isPreviewing ? (
                            <>
                              <Square className="h-3 w-3 fill-current" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Play className="h-3 w-3 fill-current" />
                              Preview
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {ambientSound !== "silence" && (
                <div className="flex items-center gap-3 rounded-xl border border-black/6 bg-[var(--background)]/60 px-3.5 py-2.5 dark:border-white/8">
                  <Volume2 className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ambientVolume}
                    onChange={(event) =>
                      onChangeAmbientVolume(Number(event.target.value))
                    }
                    aria-label="Background sound volume"
                    className="h-1.5 w-full cursor-pointer accent-[var(--accent)]"
                  />
                  <span className="w-9 text-right text-xs font-medium text-[var(--foreground-muted)] tabular-nums">
                    {Math.round(ambientVolume * 100)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
