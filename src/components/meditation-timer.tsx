"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bell,
  BellRing,
  Check,
  ChevronRight,
  EyeOff,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import { useI18n } from "@/components/i18n-provider";
import { PresetStrip } from "@/components/preset-strip";
import {
  SoundPickerSheet,
  type SoundSheetSlot,
} from "@/components/sound-picker-sheet";
import { MeditationAudioEngine } from "@/lib/audio/engine";
import type { AmbientSoundId, BellSoundId } from "@/lib/audio/sounds";
import {
  saveMeditationSession,
  updateMeditationSessionNote,
} from "@/lib/history/client";
import {
  MIN_SAVEABLE_EARLY_STOP_SECONDS,
  formatSessionDuration,
} from "@/lib/history/stats";
import type { MeditationSessionItem } from "@/lib/history/types";
import {
  clampDurationMinutes,
  clampIntervalMinutes,
  computeElapsedMs,
  computeIntervalBellIndex,
  computeProgress,
  computeRemainingMs,
  formatDurationLabel,
  formatTimerDisplay,
} from "@/lib/timer/engine";
import {
  getTimerPreferencesServerSnapshot,
  getTimerPreferencesSnapshot,
  subscribeTimerPreferences,
  updateTimerPreferences,
} from "@/lib/timer/preferences";
import {
  readLocalPresets,
  writeLocalPresets,
  type TimerPresetItem,
} from "@/lib/timer/presets";
import {
  DURATION_PRESETS_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  WARMUP_OPTIONS_SECONDS,
  type TimerPhase,
} from "@/lib/timer/types";
import { useWakeLock } from "@/lib/wake-lock";

const RING_SIZE = 264;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE * 2) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface MeditationTimerProps {
  isAuthenticated?: boolean;
  userId?: string | null;
  isOnline?: boolean;
  initialPresets?: TimerPresetItem[];
  onSessionActiveChange?: (active: boolean) => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
}

export function MeditationTimer({
  isAuthenticated = false,
  userId = null,
  isOnline = true,
  initialPresets = [],
  onSessionActiveChange,
  onSessionSaved,
  onSessionUpdated,
}: MeditationTimerProps) {
  const { m } = useI18n();
  // Persisted setup preferences (SSR-safe via useSyncExternalStore)
  const prefs = useSyncExternalStore(
    subscribeTimerPreferences,
    getTimerPreferencesSnapshot,
    getTimerPreferencesServerSnapshot
  );
  const {
    durationMinutes,
    warmupSeconds,
    startBell,
    endBell,
    intervalEnabled,
    intervalMinutes,
    intervalBell,
    ambientSound: selectedSound,
    ambientVolume,
  } = prefs;

  const [isAmbientMuted, setIsAmbientMuted] = useState<boolean>(false);
  const [previewingSoundId, setPreviewingSoundId] =
    useState<AmbientSoundId | null>(null);
  const [activeSoundSheet, setActiveSoundSheet] =
    useState<SoundSheetSlot | null>(null);

  // V5 Practice Presets & Zen Dim Mode
  const [presets, setPresets] = useState<TimerPresetItem[]>(initialPresets);
  const [isSavingPreset, setIsSavingPreset] = useState<boolean>(false);
  const [isDimmed, setIsDimmed] = useState<boolean>(false);

  // Hydrate local presets when signed out or offline, and cache cloud presets locally
  useEffect(() => {
    let cancelled = false;
    if (isAuthenticated && initialPresets.length > 0) {
      writeLocalPresets(initialPresets);
      return;
    }
    const local = readLocalPresets();
    if (local.length > 0 && initialPresets.length === 0) {
      queueMicrotask(() => {
        if (!cancelled) {
          setPresets(local);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [initialPresets, isAuthenticated]);

  // Active session state
  const [phase, setPhase] = useState<TimerPhase>("idle");
  const [pausedFromPhase, setPausedFromPhase] = useState<"warmup" | "running">(
    "running"
  );
  const [remainingMs, setRemainingMs] = useState<number>(
    durationMinutes * 60 * 1000
  );

  const endTimeRef = useRef<number | null>(null);
  const lastIntervalIndexRef = useRef<number>(0);
  const sessionStartedAtRef = useRef<string | null>(null);
  const audioRef = useRef<MeditationAudioEngine | null>(null);

  // V3/V4 History logging state
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [savedSessionPending, setSavedSessionPending] =
    useState<boolean>(false);
  const [noteInput, setNoteInput] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [noteSaved, setNoteSaved] = useState<boolean>(false);
  const [earlyStopElapsedSec, setEarlyStopElapsedSec] = useState<number | null>(
    null
  );
  const [isSavingEarlyStop, setIsSavingEarlyStop] = useState<boolean>(false);

  const getAudioEngine = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new MeditationAudioEngine();
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    onSessionActiveChange?.(phase !== "idle");
  }, [onSessionActiveChange, phase]);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const isSessionActive = phase === "warmup" || phase === "running";
  const { isActive: isWakeLockActive } = useWakeLock(isSessionActive);

  const totalSessionMs = durationMinutes * 60 * 1000;
  const totalWarmupMs = warmupSeconds * 1000;

  // Drift-free timestamp tick loop during warmup and running phases
  useEffect(() => {
    if (phase !== "warmup" && phase !== "running") {
      return;
    }

    const tick = () => {
      const target = endTimeRef.current;
      if (target === null) return;

      const nextRemaining = computeRemainingMs(target, Date.now());

      if (nextRemaining <= 0) {
        const audio = getAudioEngine();
        if (phase === "warmup") {
          const nextEnd = Date.now() + totalSessionMs;
          endTimeRef.current = nextEnd;
          lastIntervalIndexRef.current = 0;
          sessionStartedAtRef.current = new Date().toISOString();
          setRemainingMs(totalSessionMs);
          setPhase("running");
          audio.playBellSound(startBell);
          if (selectedSound !== "silence" && !isAmbientMuted) {
            audio.startAmbient(selectedSound, ambientVolume);
          }
        } else {
          endTimeRef.current = null;
          setRemainingMs(0);
          setIsDimmed(false);
          setPhase("completed");
          audio.stopAmbient(1.2);
          audio.playBellSound(endBell);

          if (isAuthenticated) {
            const endedAt = new Date().toISOString();
            const plannedSec = Math.round(totalSessionMs / 1000);
            void saveMeditationSession(
              {
                mode: "TIMER",
                plannedDurationSec: plannedSec,
                actualDurationSec: plannedSec,
                completed: true,
                startedAt: sessionStartedAtRef.current ?? undefined,
                endedAt,
              },
              userId
            ).then((saved) => {
              if (saved) {
                setSavedSessionId(saved.id);
                setSavedSessionPending(Boolean(saved.pendingSync));
                onSessionSaved?.(saved);
              }
            });
          }
        }
        return;
      }

      if (phase === "running" && intervalEnabled && intervalBell !== "none") {
        const elapsedMs = computeElapsedMs(totalSessionMs, nextRemaining);
        const nextIntervalIndex = computeIntervalBellIndex(
          elapsedMs,
          totalSessionMs,
          intervalMinutes * 60 * 1000
        );
        if (nextIntervalIndex > lastIntervalIndexRef.current) {
          lastIntervalIndexRef.current = nextIntervalIndex;
          getAudioEngine().playBellSound(intervalBell);
        }
      }

      setRemainingMs(nextRemaining);
    };

    const intervalId = window.setInterval(tick, 120);
    return () => window.clearInterval(intervalId);
  }, [
    ambientVolume,
    endBell,
    getAudioEngine,
    intervalBell,
    intervalEnabled,
    intervalMinutes,
    isAmbientMuted,
    isAuthenticated,
    onSessionSaved,
    phase,
    selectedSound,
    startBell,
    totalSessionMs,
    userId,
  ]);

  const stopPreview = useCallback(() => {
    audioRef.current?.stopPreview();
    setPreviewingSoundId(null);
  }, []);

  const handleCloseSoundSheet = useCallback(() => {
    stopPreview();
    setActiveSoundSheet(null);
  }, [stopPreview]);

  const handleDurationChange = useCallback((nextMinutes: number) => {
    const clamped = clampDurationMinutes(nextMinutes);
    updateTimerPreferences({ durationMinutes: clamped });
    setRemainingMs(clamped * 60 * 1000);
  }, []);

  const handleIntervalMinutesChange = useCallback((nextMinutes: number) => {
    updateTimerPreferences({
      intervalMinutes: clampIntervalMinutes(nextMinutes),
    });
  }, []);

  const handlePreviewBell = useCallback(
    (soundId: BellSoundId) => {
      const audio = getAudioEngine();
      audio.unlock();
      audio.playBellSound(soundId);
    },
    [getAudioEngine]
  );

  const handleTogglePreview = useCallback(
    (soundId: AmbientSoundId) => {
      const audio = getAudioEngine();
      audio.unlock();

      if (previewingSoundId === soundId) {
        audio.stopPreview();
        setPreviewingSoundId(null);
        return;
      }

      setPreviewingSoundId(soundId);
      audio.startPreview(soundId, ambientVolume, () => {
        setPreviewingSoundId(null);
      });
    },
    [ambientVolume, getAudioEngine, previewingSoundId]
  );

  const handleSelectSound = useCallback(
    (soundId: AmbientSoundId) => {
      updateTimerPreferences({ ambientSound: soundId });
      if (previewingSoundId && previewingSoundId !== soundId) {
        stopPreview();
      }
      if (soundId === "silence") {
        stopPreview();
      }
    },
    [previewingSoundId, stopPreview]
  );

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      updateTimerPreferences({ ambientVolume: nextVolume });
      setIsAmbientMuted(nextVolume === 0);
      if (previewingSoundId || phase === "running") {
        audioRef.current?.setAmbientVolume(nextVolume);
      }
    },
    [phase, previewingSoundId]
  );

  const handleToggleSessionMute = useCallback(() => {
    const audio = getAudioEngine();
    if (selectedSound === "silence") return;

    if (isAmbientMuted) {
      setIsAmbientMuted(false);
      if (phase === "running") {
        audio.startAmbient(selectedSound, ambientVolume, 0.5);
      }
    } else {
      setIsAmbientMuted(true);
      audio.stopAmbient(0.4);
    }
  }, [ambientVolume, getAudioEngine, isAmbientMuted, phase, selectedSound]);

  const handleStart = useCallback(() => {
    const audio = getAudioEngine();
    audio.unlock();
    stopPreview();
    setActiveSoundSheet(null);
    setIsAmbientMuted(false);
    setSavedSessionId(null);
    setNoteInput("");
    setNoteSaved(false);
    setEarlyStopElapsedSec(null);
    lastIntervalIndexRef.current = 0;

    if (warmupSeconds > 0) {
      const warmupMs = warmupSeconds * 1000;
      endTimeRef.current = Date.now() + warmupMs;
      sessionStartedAtRef.current = null;
      setRemainingMs(warmupMs);
      setPhase("warmup");
    } else {
      endTimeRef.current = Date.now() + totalSessionMs;
      sessionStartedAtRef.current = new Date().toISOString();
      setRemainingMs(totalSessionMs);
      setPhase("running");
      audio.playBellSound(startBell);
      if (selectedSound !== "silence") {
        audio.startAmbient(selectedSound, ambientVolume);
      }
    }
  }, [
    ambientVolume,
    getAudioEngine,
    selectedSound,
    startBell,
    stopPreview,
    totalSessionMs,
    warmupSeconds,
  ]);

  const handlePause = useCallback(() => {
    if (phase !== "warmup" && phase !== "running") return;

    const currentRemaining =
      endTimeRef.current !== null
        ? computeRemainingMs(endTimeRef.current, Date.now())
        : remainingMs;

    endTimeRef.current = null;
    setRemainingMs(currentRemaining);
    setPausedFromPhase(phase);
    setIsDimmed(false);
    setPhase("paused");
    audioRef.current?.stopAmbient(0.5);
  }, [phase, remainingMs]);

  const handleResume = useCallback(() => {
    if (phase !== "paused") return;
    const audio = getAudioEngine();
    audio.unlock();
    setEarlyStopElapsedSec(null);

    endTimeRef.current = Date.now() + remainingMs;
    setPhase(pausedFromPhase);

    if (
      pausedFromPhase === "running" &&
      selectedSound !== "silence" &&
      !isAmbientMuted
    ) {
      audio.startAmbient(selectedSound, ambientVolume, 0.8);
    }
  }, [
    ambientVolume,
    getAudioEngine,
    isAmbientMuted,
    pausedFromPhase,
    phase,
    remainingMs,
    selectedSound,
  ]);

  const resetToIdle = useCallback(() => {
    endTimeRef.current = null;
    lastIntervalIndexRef.current = 0;
    sessionStartedAtRef.current = null;
    audioRef.current?.stopAmbient(0.4);
    stopPreview();
    setIsAmbientMuted(false);
    setIsDimmed(false);
    setEarlyStopElapsedSec(null);
    setSavedSessionId(null);
    setSavedSessionPending(false);
    setNoteInput("");
    setNoteSaved(false);
    setRemainingMs(totalSessionMs);
    setPhase("idle");
  }, [stopPreview, totalSessionMs]);

  const handleReset = useCallback(() => {
    const isActiveMeditation =
      phase === "running" ||
      (phase === "paused" && pausedFromPhase === "running");

    if (isAuthenticated && isActiveMeditation) {
      const currentRemaining =
        endTimeRef.current !== null
          ? computeRemainingMs(endTimeRef.current, Date.now())
          : remainingMs;
      const elapsedSec = Math.floor(
        computeElapsedMs(totalSessionMs, currentRemaining) / 1000
      );

      if (elapsedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
        endTimeRef.current = null;
        setRemainingMs(currentRemaining);
        setPausedFromPhase("running");
        setPhase("paused");
        audioRef.current?.stopAmbient(0.4);
        setEarlyStopElapsedSec(elapsedSec);
        return;
      }
    }

    resetToIdle();
  }, [
    isAuthenticated,
    pausedFromPhase,
    phase,
    remainingMs,
    resetToIdle,
    totalSessionMs,
  ]);

  const handleSaveEarlyStop = useCallback(async () => {
    if (earlyStopElapsedSec === null) return;
    setIsSavingEarlyStop(true);
    const saved = await saveMeditationSession(
      {
        mode: "TIMER",
        plannedDurationSec: Math.round(totalSessionMs / 1000),
        actualDurationSec: earlyStopElapsedSec,
        completed: false,
        note: noteInput.trim() || null,
        startedAt: sessionStartedAtRef.current ?? undefined,
        endedAt: new Date().toISOString(),
      },
      userId
    );
    setIsSavingEarlyStop(false);
    if (saved) {
      onSessionSaved?.(saved);
    }
    resetToIdle();
  }, [
    earlyStopElapsedSec,
    noteInput,
    onSessionSaved,
    resetToIdle,
    totalSessionMs,
    userId,
  ]);

  const handleSaveCompletedNote = useCallback(async () => {
    if (!savedSessionId) return;
    setIsSavingNote(true);
    const updated = await updateMeditationSessionNote(
      savedSessionId,
      noteInput.trim() || null,
      userId
    );
    setIsSavingNote(false);
    if (updated) {
      setNoteSaved(true);
      onSessionUpdated?.(updated);
    }
  }, [noteInput, onSessionUpdated, savedSessionId, userId]);

  // Compute progress ring geometry
  const activeTotalMs =
    phase === "warmup" || (phase === "paused" && pausedFromPhase === "warmup")
      ? totalWarmupMs
      : totalSessionMs;
  const progress =
    phase === "idle"
      ? 0
      : phase === "completed"
        ? 1
        : computeProgress(activeTotalMs, remainingMs);
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);

  const startBellName = m.sounds.bells[startBell];
  const endBellName = m.sounds.bells[endBell];
  const intervalBellName = m.sounds.bells[intervalBell];
  const selectedSoundName = m.sounds.ambient[selectedSound];

  const activeSessionSubtitleParts: string[] = [];
  if (selectedSound !== "silence") {
    activeSessionSubtitleParts.push(selectedSoundName);
  }
  if (intervalEnabled) {
    activeSessionSubtitleParts.push(m.timer.everyMinutes(intervalMinutes));
  }
  const activeSessionSubtitle =
    activeSessionSubtitleParts.length > 0
      ? activeSessionSubtitleParts.join(" · ")
      : formatDurationLabel(durationMinutes);

  const soundSummaryRows: Array<{
    slot: SoundSheetSlot;
    label: string;
    value: string;
    isMutedValue?: boolean;
    icon: typeof Bell;
  }> = [
    {
      slot: "start",
      label: m.timer.slotStart,
      value: startBellName,
      isMutedValue: startBell === "none",
      icon: Bell,
    },
    {
      slot: "interval",
      label: m.timer.slotInterval,
      value: intervalEnabled
        ? `${intervalBellName} · ${intervalMinutes}m`
        : m.common.off,
      isMutedValue: !intervalEnabled,
      icon: Repeat,
    },
    {
      slot: "end",
      label: m.timer.slotEnd,
      value: endBellName,
      isMutedValue: endBell === "none",
      icon: BellRing,
    },
    {
      slot: "background",
      label: m.timer.slotBackground,
      value:
        selectedSound === "silence"
          ? m.sounds.ambient.silence
          : `${selectedSoundName} · ${Math.round(ambientVolume * 100)}%`,
      isMutedValue: selectedSound === "silence",
      icon: Volume2,
    },
  ];

  const handleApplyPreset = useCallback(
    (preset: TimerPresetItem) => {
      stopPreview();
      updateTimerPreferences(preset.preferences);
      setRemainingMs(preset.preferences.durationMinutes * 60 * 1000);
    },
    [stopPreview]
  );

  const handleCreatePreset = useCallback(
    async (name: string): Promise<boolean> => {
      setIsSavingPreset(true);
      try {
        if (isAuthenticated && isOnline) {
          const response = await fetch("/api/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, preferences: prefs }),
          });
          if (response.ok) {
            const data = (await response.json()) as {
              preset?: TimerPresetItem;
            };
            if (data.preset) {
              const created = data.preset;
              setPresets((prev) => {
                const next = [...prev, created];
                writeLocalPresets(next);
                return next;
              });
              return true;
            }
          }
        }

        // Local fallback when signed out or offline
        const localPreset: TimerPresetItem = {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          preferences: { ...prefs },
          createdAt: new Date().toISOString(),
        };
        setPresets((prev) => {
          const next = [...prev, localPreset];
          writeLocalPresets(next);
          return next;
        });
        return true;
      } catch {
        return false;
      } finally {
        setIsSavingPreset(false);
      }
    },
    [isAuthenticated, isOnline, prefs]
  );

  const handleDeletePreset = useCallback(
    async (id: string) => {
      if (isAuthenticated && isOnline && !id.startsWith("local-")) {
        try {
          await fetch(`/api/presets/${id}`, { method: "DELETE" });
        } catch {
          // Ignore network failures and still update local view cleanly
        }
      }
      setPresets((prev) => {
        const next = prev.filter((item) => item.id !== id);
        writeLocalPresets(next);
        return next;
      });
    },
    [isAuthenticated, isOnline]
  );

  return (
    <>
      {phase === "idle" && (
          <>
            {/* Duration Preview & Fine Adjustment */}
            <section className="flex flex-col items-center pt-1">
              <div className="relative flex h-44 w-44 flex-col items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] shadow-xs dark:border-white/10">
                <span className="text-[11px] font-medium tracking-[0.18em] text-[var(--foreground-muted)] uppercase">
                  {m.timer.duration}
                </span>
                <span className="mt-1 font-mono text-4xl font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                  {formatTimerDisplay(totalSessionMs)}
                </span>
                <div className="mt-2.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleDurationChange(durationMinutes - 1)}
                    disabled={durationMinutes <= MIN_DURATION_MINUTES}
                    aria-label={m.timer.decreaseDurationAria}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[3.5rem] text-center text-xs font-medium text-[var(--foreground-muted)] tabular-nums">
                    {formatDurationLabel(durationMinutes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDurationChange(durationMinutes + 1)}
                    disabled={durationMinutes >= MAX_DURATION_MINUTES}
                    aria-label={m.timer.increaseDurationAria}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Single-row Duration Presets */}
              <div className="mt-5 grid w-full grid-cols-5 gap-2">
                {DURATION_PRESETS_MINUTES.map((preset) => {
                  const isSelected = durationMinutes === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleDurationChange(preset)}
                      className={`h-10 rounded-xl text-sm font-medium whitespace-nowrap tabular-nums transition-colors ${
                        isSelected
                          ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                          : "border border-black/6 bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                      }`}
                    >
                      {preset}m
                    </button>
                  );
                })}
              </div>

              {/* Saved Practice Presets Strip */}
              <div className="mt-3 w-full">
                <PresetStrip
                  presets={presets}
                  currentPreferences={prefs}
                  isSaving={isSavingPreset}
                  onApply={handleApplyPreset}
                  onCreate={handleCreatePreset}
                  onDelete={handleDeletePreset}
                />
              </div>
            </section>

            {/* Warm-up & Sound Controls */}
            <section className="flex flex-col gap-3">
              {/* Warm-up Selector */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] px-4 py-3 dark:border-white/10">
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {m.timer.warmup}
                  </p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    {m.timer.warmupSubtitle}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
                  {WARMUP_OPTIONS_SECONDS.map((seconds) => {
                    const isSelected = warmupSeconds === seconds;
                    return (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() =>
                          updateTimerPreferences({ warmupSeconds: seconds })
                        }
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap tabular-nums transition-colors ${
                          isSelected
                            ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                            : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        {seconds === 0 ? m.common.off : `${seconds}s`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Compact Sounds Summary Card */}
              <div className="overflow-hidden rounded-2xl border border-black/6 bg-[var(--surface)] dark:border-white/10">
                <div className="divide-y divide-black/5 dark:divide-white/8">
                  {soundSummaryRows.map((row) => {
                    const Icon = row.icon;
                    return (
                      <button
                        key={row.slot}
                        type="button"
                        onClick={() => setActiveSoundSheet(row.slot)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-muted)]/60 active:bg-[var(--surface-muted)]"
                      >
                        <span className="flex items-center gap-2.5 text-sm font-medium text-[var(--foreground)]">
                          <Icon className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                          {row.label}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={`truncate text-xs font-medium tabular-nums ${
                              row.isMutedValue
                                ? "text-[var(--foreground-muted)]"
                                : "text-[var(--accent)]"
                            }`}
                          >
                            {row.value}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]/70" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Primary CTA */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleStart}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-base font-semibold text-[#fcfaf6] shadow-xs transition-colors hover:bg-[var(--accent-strong)] active:scale-[0.99] dark:text-[#151917]"
              >
                <Play className="h-4 w-4 fill-current" />
                {m.timer.beginSession}
              </button>
            </div>
          </>
        )}

        {(phase === "warmup" || phase === "running" || phase === "paused") && (
          <div className="flex flex-1 flex-col items-center justify-between py-4">
            {/* Phase Status Pill */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3.5 py-1 text-xs font-medium tracking-wide text-[var(--accent)] uppercase">
                <span
                  className={`h-1.5 w-1.5 rounded-full bg-[var(--accent)] ${
                    phase === "running" || phase === "warmup"
                      ? "animate-pulse"
                      : "opacity-50"
                  }`}
                />
                {phase === "warmup"
                  ? m.timer.phasePrepare
                  : phase === "paused"
                    ? m.timer.phasePaused
                    : m.timer.phaseMeditating}
              </span>
              {isWakeLockActive && (
                <span className="text-[11px] text-[var(--foreground-muted)]">
                  {m.timer.screenAwake}
                </span>
              )}
            </div>

            {/* Serene Circular Progress Dial */}
            <div className="relative flex items-center justify-center">
              {phase === "running" && (
                <div
                  aria-hidden="true"
                  className="animate-breathe pointer-events-none absolute h-64 w-64 rounded-full bg-[var(--accent)]/12 blur-2xl"
                />
              )}

              <svg
                width={RING_SIZE}
                height={RING_SIZE}
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                className="-rotate-90"
              >
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={RING_STROKE}
                  className="text-black/8 dark:text-white/10"
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  className={
                    phase === "warmup"
                      ? "text-[var(--warm-amber)] transition-[stroke-dashoffset] duration-150 ease-linear"
                      : "text-[var(--accent)] transition-[stroke-dashoffset] duration-150 ease-linear"
                  }
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="font-mono text-5xl font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                  {formatTimerDisplay(remainingMs)}
                </span>
                <span className="mt-2 text-xs text-[var(--foreground-muted)]">
                  {phase === "warmup"
                    ? m.timer.takeComfortableSeat
                    : activeSessionSubtitle}
                </span>
              </div>
            </div>

            {/* Active Session Controls */}
            <div className="flex w-full flex-col items-center gap-3">
              {earlyStopElapsedSec === null && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {selectedSound !== "silence" && (
                    <button
                      type="button"
                      onClick={handleToggleSessionMute}
                      className="inline-flex items-center gap-2 rounded-full border border-black/6 bg-[var(--surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
                    >
                      {isAmbientMuted ? (
                        <>
                          <VolumeX className="h-3.5 w-3.5" />
                          {m.timer.soundMuted}
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5" />
                          {m.timer.soundOn(selectedSoundName)}
                        </>
                      )}
                    </button>
                  )}

                  {(phase === "warmup" || phase === "running") && (
                    <button
                      type="button"
                      onClick={() => setIsDimmed(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-[var(--surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      {m.timer.dimScreen}
                    </button>
                  )}
                </div>
              )}

              {/* OLED-friendly Zen Dim Mode Overlay */}
              {isDimmed && (phase === "warmup" || phase === "running") && (
                <button
                  type="button"
                  onClick={() => setIsDimmed(false)}
                  aria-label={m.timer.wakeDimmedAria}
                  className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#050605] text-center focus:outline-none"
                >
                  <span className="font-mono text-4xl font-normal tracking-tight text-white/25 tabular-nums">
                    {formatTimerDisplay(remainingMs)}
                  </span>
                  <span className="text-[11px] tracking-wide text-white/15">
                    {m.timer.tapToWake}
                  </span>
                </button>
              )}

              {earlyStopElapsedSec !== null ? (
                <div className="w-full rounded-2xl border border-black/8 bg-[var(--surface)] p-4 text-left shadow-xs dark:border-white/10">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {m.timer.savePartialTitle}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                    {m.timer.meditatedFor(
                      formatSessionDuration(earlyStopElapsedSec)
                    )}
                  </p>
                  <textarea
                    rows={2}
                    maxLength={500}
                    placeholder={m.timer.optionalNotePlaceholder}
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                    className="mt-2.5 w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={resetToIdle}
                      disabled={isSavingEarlyStop}
                      className="flex h-10 items-center justify-center rounded-xl border border-black/8 bg-[var(--background)] text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                    >
                      {m.timer.discard}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveEarlyStop()}
                      disabled={isSavingEarlyStop}
                      className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
                    >
                      {isSavingEarlyStop ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {m.timer.saveSession}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid w-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {m.timer.reset}
                  </button>

                  {phase === "paused" ? (
                    <button
                      type="button"
                      onClick={handleResume}
                      className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      {m.timer.resume}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePause}
                      className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                    >
                      <Pause className="h-4 w-4 fill-current" />
                      {m.timer.pause}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "completed" && (
          <div className="flex flex-1 flex-col items-center justify-between gap-4 py-6 text-center">
            <div />

            <div className="flex w-full flex-col items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--accent-soft)]">
                <BodhiLogo className="h-11 w-11" />
              </div>

              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                  {m.timer.sessionComplete}
                </h1>
                <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
                  {m.timer.mindfulStillness(
                    formatDurationLabel(durationMinutes)
                  )}
                </p>
                {savedSessionId && (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                    <Check className="h-3 w-3" />
                    {savedSessionPending
                      ? m.timer.savedOffline
                      : m.timer.savedToHistory}
                  </p>
                )}
              </div>

              {savedSessionId && (
                <div className="w-full rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 text-left dark:border-white/10">
                  <textarea
                    rows={2}
                    maxLength={500}
                    placeholder={m.timer.addReflectionPlaceholder}
                    value={noteInput}
                    onChange={(event) => {
                      setNoteInput(event.target.value);
                      setNoteSaved(false);
                    }}
                    className="w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-[var(--foreground-muted)]">
                      {noteSaved ? m.timer.noteSaved : m.timer.optionalNote}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSaveCompletedNote()}
                      disabled={isSavingNote || !noteInput.trim()}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#fcfaf6] disabled:opacity-40 dark:text-[#151917]"
                    >
                      {isSavingNote ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      {m.timer.saveNote}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={resetToIdle}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
              >
                {m.timer.configure}
              </button>
              <button
                type="button"
                onClick={handleStart}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
              >
                <RotateCcw className="h-4 w-4" />
                {m.timer.repeat}
              </button>
            </div>
          </div>
        )}
        <SoundPickerSheet
          slot={phase === "idle" ? activeSoundSheet : null}
          durationMinutes={durationMinutes}
          startBell={startBell}
          endBell={endBell}
          intervalEnabled={intervalEnabled}
          intervalMinutes={intervalMinutes}
          intervalBell={intervalBell}
          ambientSound={selectedSound}
          ambientVolume={ambientVolume}
          previewingAmbientId={previewingSoundId}
          onClose={handleCloseSoundSheet}
          onSelectStartBell={(id) => updateTimerPreferences({ startBell: id })}
          onSelectEndBell={(id) => updateTimerPreferences({ endBell: id })}
          onToggleIntervalEnabled={(enabled) =>
            updateTimerPreferences({ intervalEnabled: enabled })
          }
          onChangeIntervalMinutes={handleIntervalMinutesChange}
          onSelectIntervalBell={(id) =>
            updateTimerPreferences({ intervalBell: id })
          }
          onSelectAmbientSound={handleSelectSound}
          onChangeAmbientVolume={handleVolumeChange}
          onPreviewBell={handlePreviewBell}
          onTogglePreviewAmbient={handleTogglePreview}
        />
    </>
  );
}
