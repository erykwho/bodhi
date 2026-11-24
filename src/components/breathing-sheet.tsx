"use client";

import { useEffect } from "react";
import {
  Bell,
  Check,
  Minus,
  Play,
  Plus,
  ShieldAlert,
  Vibrate,
  X,
} from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import {
  BREATHING_CUE_MODES,
  DEFAULT_RETENTION_CONFIG,
  MAX_EXHALE_PHASE_SEC,
  MAX_HOLD_PHASE_SEC,
  MAX_INHALE_PHASE_SEC,
  MAX_RECOVERY_HOLD_SEC,
  MIN_ACTIVE_PHASE_SEC,
  MIN_RECOVERY_HOLD_SEC,
  RETENTION_BREATH_PRESETS,
  type BreathingCueMode,
  type BreathingRhythm,
  type RetentionConfig,
} from "@/lib/breathing/types";

export type BreathingSheetSlot = "cues" | "custom" | "retention";

interface BreathingSheetProps {
  slot: BreathingSheetSlot | null;
  cueMode: BreathingCueMode;
  hapticsEnabled: boolean;
  customRhythm: BreathingRhythm;
  retentionConfig?: RetentionConfig;
  onClose: () => void;
  onSelectCueMode: (mode: BreathingCueMode) => void;
  onPreviewCueMode: (mode: BreathingCueMode) => void;
  onToggleHaptics: (enabled: boolean) => void;
  onChangeCustomRhythm: (rhythm: BreathingRhythm) => void;
  onChangeRetentionConfig?: (config: RetentionConfig) => void;
}

export function BreathingSheet({
  slot,
  cueMode,
  hapticsEnabled,
  customRhythm,
  retentionConfig = DEFAULT_RETENTION_CONFIG,
  onClose,
  onSelectCueMode,
  onPreviewCueMode,
  onToggleHaptics,
  onChangeCustomRhythm,
  onChangeRetentionConfig,
}: BreathingSheetProps) {
  const { m } = useI18n();

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

  const title =
    slot === "cues"
      ? m.breathing.cuesSheetTitle
      : slot === "retention"
        ? m.breathing.retentionSheetTitle
        : m.breathing.customSheetTitle;
  const subtitle =
    slot === "cues"
      ? m.breathing.cuesSheetSubtitle
      : slot === "retention"
        ? m.breathing.retentionSheetSubtitle
        : m.breathing.customSheetSubtitle;

  const phaseRows: Array<{
    key: keyof BreathingRhythm;
    label: string;
    min: number;
    max: number;
    value: number;
  }> = [
    {
      key: "inhaleSec",
      label: m.breathing.phaseInhaleSec,
      min: MIN_ACTIVE_PHASE_SEC,
      max: MAX_INHALE_PHASE_SEC,
      value: customRhythm.inhaleSec,
    },
    {
      key: "holdInSec",
      label: m.breathing.phaseHoldInSec,
      min: 0,
      max: MAX_HOLD_PHASE_SEC,
      value: customRhythm.holdInSec,
    },
    {
      key: "exhaleSec",
      label: m.breathing.phaseExhaleSec,
      min: MIN_ACTIVE_PHASE_SEC,
      max: MAX_EXHALE_PHASE_SEC,
      value: customRhythm.exhaleSec,
    },
    {
      key: "holdOutSec",
      label: m.breathing.phaseHoldOutSec,
      min: 0,
      max: MAX_HOLD_PHASE_SEC,
      value: customRhythm.holdOutSec,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82dvh] w-full max-w-md flex-col rounded-t-3xl border border-black/8 bg-[var(--surface)] shadow-xl dark:border-white/10 sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.soundPicker.closeLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {slot === "cues" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                {BREATHING_CUE_MODES.map((mode) => {
                  const isSelected = cueMode === mode;
                  const canPreview = mode !== "silent";
                  return (
                    <div
                      key={mode}
                      className={`flex items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 transition-colors ${
                        isSelected
                          ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                          : "border-black/6 bg-[var(--background)]/60 hover:bg-[var(--surface-muted)]/60 dark:border-white/8"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectCueMode(mode)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            isSelected
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                              : "border-black/15 dark:border-white/20"
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate text-sm font-medium text-[var(--foreground)]">
                          {m.breathing.cueModes[mode]}
                        </span>
                      </button>

                      {canPreview && (
                        <button
                          type="button"
                          onClick={() => onPreviewCueMode(mode)}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border border-black/8 bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          {m.soundPicker.preview}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--background)]/70 px-4 py-3 dark:border-white/8">
                <div className="flex items-center gap-2.5">
                  <Vibrate className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {m.breathing.hapticsLabel}
                    </p>
                    <p className="text-[11px] text-[var(--foreground-muted)]">
                      {m.breathing.hapticsSubtitle}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={hapticsEnabled}
                  aria-label={m.breathing.hapticsLabel}
                  onClick={() => onToggleHaptics(!hapticsEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    hapticsEnabled
                      ? "bg-[var(--accent)]"
                      : "bg-black/15 dark:bg-white/20"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                      hapticsEnabled ? "translate-x-5.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          ) : slot === "retention" ? (
            <div className="flex flex-col gap-3">
              {/* Breaths per round presets */}
              <div className="flex flex-col gap-2 rounded-2xl border border-black/6 bg-[var(--background)]/70 px-4 py-3 dark:border-white/8">
                <span className="text-sm font-medium text-[var(--foreground)]">
                  {m.breathing.breathsPerRoundLabel}
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {RETENTION_BREATH_PRESETS.map((count) => {
                    const isSelected = retentionConfig.breathsPerRound === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() =>
                          onChangeRetentionConfig?.({
                            ...retentionConfig,
                            breathsPerRound: count,
                          })
                        }
                        className={`h-9 rounded-xl font-mono text-sm font-medium tabular-nums transition-colors ${
                          isSelected
                            ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                            : "border border-black/8 bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                        }`}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recovery hold duration stepper */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--background)]/70 px-4 py-3 dark:border-white/8">
                <span className="text-sm font-medium text-[var(--foreground)]">
                  {m.breathing.recoveryHoldLabel}
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeRetentionConfig?.({
                        ...retentionConfig,
                        recoveryHoldSec: Math.max(
                          MIN_RECOVERY_HOLD_SEC,
                          retentionConfig.recoveryHoldSec - 1
                        ),
                      })
                    }
                    disabled={
                      retentionConfig.recoveryHoldSec <= MIN_RECOVERY_HOLD_SEC
                    }
                    aria-label={`${m.breathing.recoveryHoldLabel} -1s`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-35"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[2.75rem] text-center font-mono text-sm font-medium text-[var(--foreground)] tabular-nums">
                    {m.breathing.secondsShort(retentionConfig.recoveryHoldSec)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeRetentionConfig?.({
                        ...retentionConfig,
                        recoveryHoldSec: Math.min(
                          MAX_RECOVERY_HOLD_SEC,
                          retentionConfig.recoveryHoldSec + 1
                        ),
                      })
                    }
                    disabled={
                      retentionConfig.recoveryHoldSec >= MAX_RECOVERY_HOLD_SEC
                    }
                    aria-label={`${m.breathing.recoveryHoldLabel} +1s`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-35"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Minute chime toggle during empty-lung hold */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--background)]/70 px-4 py-3 dark:border-white/8">
                <div className="flex items-center gap-2.5">
                  <Bell className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {m.breathing.minuteChimeLabel}
                    </p>
                    <p className="text-[11px] text-[var(--foreground-muted)]">
                      {m.breathing.minuteChimeSubtitle}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={retentionConfig.retentionMinuteChime}
                  aria-label={m.breathing.minuteChimeLabel}
                  onClick={() =>
                    onChangeRetentionConfig?.({
                      ...retentionConfig,
                      retentionMinuteChime: !retentionConfig.retentionMinuteChime,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    retentionConfig.retentionMinuteChime
                      ? "bg-[var(--accent)]"
                      : "bg-black/15 dark:bg-white/20"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                      retentionConfig.retentionMinuteChime
                        ? "translate-x-5.5"
                        : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Safety reminder */}
              <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--warm-amber)]/25 bg-[var(--warm-amber)]/8 px-3.5 py-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warm-amber)]" />
                <div className="text-left">
                  <p className="text-xs font-semibold text-[var(--foreground)]">
                    {m.breathing.safetyNoticeTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--foreground-muted)]">
                    {m.breathing.safetyNoticeBody}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {phaseRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--background)]/70 px-4 py-3 dark:border-white/8"
                >
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    {row.label}
                  </span>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        onChangeCustomRhythm({
                          ...customRhythm,
                          [row.key]: Math.max(row.min, row.value - 1),
                        })
                      }
                      disabled={row.value <= row.min}
                      aria-label={`${row.label} -1s`}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-35"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[2.75rem] text-center font-mono text-sm font-medium text-[var(--foreground)] tabular-nums">
                      {row.value === 0
                        ? m.common.off
                        : m.breathing.secondsShort(row.value)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeCustomRhythm({
                          ...customRhythm,
                          [row.key]: Math.min(row.max, row.value + 1),
                        })
                      }
                      disabled={row.value >= row.max}
                      aria-label={`${row.label} +1s`}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-35"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
          >
            {m.common.done}
          </button>
        </div>
      </div>
    </div>
  );
}
