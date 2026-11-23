"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Check,
  ChevronRight,
  EyeOff,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  Wind,
} from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import {
  BreathingSheet,
  type BreathingSheetSlot,
} from "@/components/breathing-sheet";
import { EarlyFinishCard } from "@/components/early-finish-card";
import { useI18n } from "@/components/i18n-provider";
import { SoundPickerSheet } from "@/components/sound-picker-sheet";
import { ZenDimOverlay } from "@/components/zen-dim-overlay";
import { MeditationAudioEngine } from "@/lib/audio/engine";
import type { AmbientSoundId } from "@/lib/audio/sounds";
import {
  clampBreathingDurationMinutes,
  computeBreathingSnapshot,
  estimateTotalCycles,
  formatBreathingHistoryLabel,
  formatBreathingRhythm,
  resolveBreathingRhythm,
} from "@/lib/breathing/engine";
import {
  getBreathingPreferencesServerSnapshot,
  getBreathingPreferencesSnapshot,
  subscribeBreathingPreferences,
  updateBreathingPreferences,
} from "@/lib/breathing/preferences";
import {
  BREATHING_PATTERN_IDS,
  MAX_BREATHING_DURATION_MINUTES,
  MIN_BREATHING_DURATION_MINUTES,
  type BreathingCueMode,
  type BreathingPatternId,
  type BreathingPhase,
} from "@/lib/breathing/types";
import {
  saveMeditationSession,
  updateMeditationSessionNote,
} from "@/lib/history/client";
import {
  MIN_SAVEABLE_EARLY_STOP_SECONDS,
  formatSessionDuration,
} from "@/lib/history/stats";
import type { MeditationSessionItem } from "@/lib/history/types";
import { formatDurationLabel, formatTimerDisplay } from "@/lib/timer/engine";
import { useWakeLock } from "@/lib/wake-lock";

type BreathingSessionPhase = "idle" | "running" | "paused" | "completed";

const ARC_SIZE = 152;
const ARC_STROKE = 3;
const ARC_RADIUS = (ARC_SIZE - ARC_STROKE * 2) / 2;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;

function triggerPhaseHaptic(phase: BreathingPhase): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    if (phase === "inhale") {
      navigator.vibrate(24);
    } else if (phase === "exhale") {
      navigator.vibrate([16, 40, 16]);
    } else {
      navigator.vibrate(12);
    }
  } catch {
    // Ignore vibration permission or unsupported platform errors
  }
}

interface BreathingPracticeProps {
  isAuthenticated?: boolean;
  userId?: string | null;
  meditationDurationMinutes: number;
  meditationOpenEnded: boolean;
  bellVolume: number;
  onSessionActiveChange?: (active: boolean) => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
  onContinueToMeditation?: () => void;
}

export function BreathingPractice({
  isAuthenticated = false,
  userId = null,
  meditationDurationMinutes,
  meditationOpenEnded,
  bellVolume,
  onSessionActiveChange,
  onSessionSaved,
  onSessionUpdated,
  onContinueToMeditation,
}: BreathingPracticeProps) {
  const { m } = useI18n();
  const prefs = useSyncExternalStore(
    subscribeBreathingPreferences,
    getBreathingPreferencesSnapshot,
    getBreathingPreferencesServerSnapshot
  );

  const {
    patternId,
    customRhythm,
    durationMinutes,
    cueMode,
    hapticsEnabled,
    ambientSound,
    ambientVolume,
  } = prefs;

  const rhythm = useMemo(
    () => resolveBreathingRhythm(patternId, customRhythm),
    [customRhythm, patternId]
  );
  const totalDurationMs = durationMinutes * 60 * 1000;
  const estimatedCycles = useMemo(
    () => estimateTotalCycles(durationMinutes, rhythm),
    [durationMinutes, rhythm]
  );

  const [sessionPhase, setSessionPhase] =
    useState<BreathingSessionPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [isAmbientMuted, setIsAmbientMuted] = useState<boolean>(false);
  const [isDimmed, setIsDimmed] = useState<boolean>(false);
  const [previewingAmbientId, setPreviewingAmbientId] =
    useState<AmbientSoundId | null>(null);
  const [activeBreathingSheet, setActiveBreathingSheet] =
    useState<BreathingSheetSlot | null>(null);
  const [isSoundSheetOpen, setIsSoundSheetOpen] = useState<boolean>(false);

  // History logging state
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [savedSessionPending, setSavedSessionPending] =
    useState<boolean>(false);
  const [completedCycles, setCompletedCycles] = useState<number>(0);
  const [noteInput, setNoteInput] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [noteSaved, setNoteSaved] = useState<boolean>(false);
  const [earlyFinishElapsedSec, setEarlyFinishElapsedSec] = useState<
    number | null
  >(null);
  const [isSavingEarlyFinish, setIsSavingEarlyFinish] =
    useState<boolean>(false);

  const segmentStartTimestampRef = useRef<number | null>(null);
  const accumulatedElapsedMsRef = useRef<number>(0);
  const lastPhaseStepRef = useRef<number>(-1);
  const sessionStartedAtRef = useRef<string | null>(null);
  const audioRef = useRef<MeditationAudioEngine | null>(null);

  const getAudioEngine = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new MeditationAudioEngine();
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    onSessionActiveChange?.(sessionPhase !== "idle");
  }, [onSessionActiveChange, sessionPhase]);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const { isActive: isWakeLockActive } = useWakeLock(sessionPhase === "running");

  const getLiveElapsedMs = useCallback(() => {
    if (segmentStartTimestampRef.current === null) {
      return accumulatedElapsedMsRef.current;
    }
    return (
      accumulatedElapsedMsRef.current +
      Math.max(0, Date.now() - segmentStartTimestampRef.current)
    );
  }, []);

  const stopPreview = useCallback(() => {
    audioRef.current?.stopPreview();
    setPreviewingAmbientId(null);
  }, []);

  // Drift-free animation frame loop for smooth breathing orb & phase transitions
  useEffect(() => {
    if (sessionPhase !== "running") return;

    let frameId = 0;

    const tick = () => {
      const liveElapsed = getLiveElapsedMs();

      if (liveElapsed >= totalDurationMs) {
        accumulatedElapsedMsRef.current = totalDurationMs;
        segmentStartTimestampRef.current = null;
        const finalSnap = computeBreathingSnapshot(totalDurationMs, rhythm);
        setElapsedMs(totalDurationMs);
        setCompletedCycles(Math.max(1, finalSnap.completedCycles));
        setIsDimmed(false);
        setSessionPhase("completed");

        const audio = getAudioEngine();
        audio.stopAmbient(1.0);
        audio.playBellSound("soft-chime", bellVolume);

        if (isAuthenticated) {
          const plannedSec = Math.round(totalDurationMs / 1000);
          const patternLabel = formatBreathingHistoryLabel(patternId, rhythm);
          void saveMeditationSession(
            {
              mode: "BREATHING",
              breathingPattern: patternLabel,
              plannedDurationSec: plannedSec,
              actualDurationSec: plannedSec,
              completed: true,
              startedAt: sessionStartedAtRef.current ?? undefined,
              endedAt: new Date().toISOString(),
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
        return;
      }

      const snap = computeBreathingSnapshot(liveElapsed, rhythm);
      if (snap.phaseStepIndex !== lastPhaseStepRef.current) {
        lastPhaseStepRef.current = snap.phaseStepIndex;
        getAudioEngine().playBreathingCue(snap.phase, cueMode, bellVolume);
        if (hapticsEnabled) {
          triggerPhaseHaptic(snap.phase);
        }
      }

      setElapsedMs(liveElapsed);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    bellVolume,
    cueMode,
    getAudioEngine,
    getLiveElapsedMs,
    hapticsEnabled,
    isAuthenticated,
    onSessionSaved,
    patternId,
    rhythm,
    sessionPhase,
    totalDurationMs,
    userId,
  ]);

  const handleSelectPattern = useCallback(
    (nextPattern: BreathingPatternId) => {
      updateBreathingPreferences({ patternId: nextPattern });
      if (nextPattern === "custom") {
        setActiveBreathingSheet("custom");
      }
    },
    []
  );

  const handleDurationChange = useCallback((nextMinutes: number) => {
    updateBreathingPreferences({
      durationMinutes: clampBreathingDurationMinutes(nextMinutes),
    });
  }, []);

  const handlePreviewCue = useCallback(
    (mode: BreathingCueMode) => {
      const audio = getAudioEngine();
      audio.unlock();
      audio.playBreathingCue("inhale", mode, bellVolume);
    },
    [bellVolume, getAudioEngine]
  );

  const handleTogglePreviewAmbient = useCallback(
    (soundId: AmbientSoundId) => {
      const audio = getAudioEngine();
      audio.unlock();

      if (previewingAmbientId === soundId) {
        audio.stopPreview();
        setPreviewingAmbientId(null);
        return;
      }

      setPreviewingAmbientId(soundId);
      audio.startPreview(soundId, ambientVolume, () => {
        setPreviewingAmbientId(null);
      });
    },
    [ambientVolume, getAudioEngine, previewingAmbientId]
  );

  const handleSelectAmbient = useCallback(
    (soundId: AmbientSoundId) => {
      updateBreathingPreferences({ ambientSound: soundId });
      if (previewingAmbientId && previewingAmbientId !== soundId) {
        stopPreview();
      }
      if (soundId === "silence") {
        stopPreview();
      }
    },
    [previewingAmbientId, stopPreview]
  );

  const handleAmbientVolumeChange = useCallback(
    (nextVolume: number) => {
      updateBreathingPreferences({ ambientVolume: nextVolume });
      setIsAmbientMuted(nextVolume === 0);
      if (previewingAmbientId || sessionPhase === "running") {
        audioRef.current?.setAmbientVolume(nextVolume);
      }
    },
    [previewingAmbientId, sessionPhase]
  );

  const handleToggleSessionMute = useCallback(() => {
    const audio = getAudioEngine();
    if (ambientSound === "silence") return;

    if (isAmbientMuted) {
      setIsAmbientMuted(false);
      if (sessionPhase === "running") {
        audio.startAmbient(ambientSound, ambientVolume, 0.5);
      }
    } else {
      setIsAmbientMuted(true);
      audio.stopAmbient(0.4);
    }
  }, [ambientSound, ambientVolume, getAudioEngine, isAmbientMuted, sessionPhase]);

  const handleStart = useCallback(() => {
    const audio = getAudioEngine();
    audio.unlock();
    stopPreview();
    setActiveBreathingSheet(null);
    setIsSoundSheetOpen(false);
    setIsAmbientMuted(false);
    setIsDimmed(false);
    setSavedSessionId(null);
    setSavedSessionPending(false);
    setCompletedCycles(0);
    setNoteInput("");
    setNoteSaved(false);
    setEarlyFinishElapsedSec(null);

    accumulatedElapsedMsRef.current = 0;
    segmentStartTimestampRef.current = Date.now();
    lastPhaseStepRef.current = 0;
    sessionStartedAtRef.current = new Date().toISOString();
    setElapsedMs(0);
    setSessionPhase("running");

    // Trigger initial inhale cue immediately on user gesture
    audio.playBreathingCue("inhale", cueMode, bellVolume);
    if (hapticsEnabled) {
      triggerPhaseHaptic("inhale");
    }
    if (ambientSound !== "silence") {
      audio.startAmbient(ambientSound, ambientVolume);
    }
  }, [
    ambientSound,
    ambientVolume,
    bellVolume,
    cueMode,
    getAudioEngine,
    hapticsEnabled,
    stopPreview,
  ]);

  const handlePause = useCallback(() => {
    if (sessionPhase !== "running") return;
    const live = getLiveElapsedMs();
    accumulatedElapsedMsRef.current = live;
    segmentStartTimestampRef.current = null;
    setElapsedMs(live);
    setIsDimmed(false);
    setSessionPhase("paused");
    audioRef.current?.stopAmbient(0.4);
  }, [getLiveElapsedMs, sessionPhase]);

  const handleResume = useCallback(() => {
    if (sessionPhase !== "paused") return;
    const audio = getAudioEngine();
    audio.unlock();
    setEarlyFinishElapsedSec(null);
    segmentStartTimestampRef.current = Date.now();
    setSessionPhase("running");

    if (ambientSound !== "silence" && !isAmbientMuted) {
      audio.startAmbient(ambientSound, ambientVolume, 0.7);
    }
  }, [
    ambientSound,
    ambientVolume,
    getAudioEngine,
    isAmbientMuted,
    sessionPhase,
  ]);

  const resetToIdle = useCallback(() => {
    segmentStartTimestampRef.current = null;
    accumulatedElapsedMsRef.current = 0;
    lastPhaseStepRef.current = -1;
    sessionStartedAtRef.current = null;
    audioRef.current?.stopAmbient(0.4);
    audioRef.current?.cancelBellStrikes();
    stopPreview();
    setIsAmbientMuted(false);
    setIsDimmed(false);
    setEarlyFinishElapsedSec(null);
    setSavedSessionId(null);
    setSavedSessionPending(false);
    setNoteInput("");
    setNoteSaved(false);
    setElapsedMs(0);
    setSessionPhase("idle");
  }, [stopPreview]);

  const handleFinish = useCallback(() => {
    const live = getLiveElapsedMs();
    const elapsedSec = Math.floor(live / 1000);

    if (isAuthenticated && elapsedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
      accumulatedElapsedMsRef.current = live;
      segmentStartTimestampRef.current = null;
      setElapsedMs(live);
      setIsDimmed(false);
      setSessionPhase("paused");
      audioRef.current?.stopAmbient(0.4);
      setEarlyFinishElapsedSec(elapsedSec);
      return;
    }

    resetToIdle();
  }, [getLiveElapsedMs, isAuthenticated, resetToIdle]);

  const handleSaveEarlyFinish = useCallback(async () => {
    if (earlyFinishElapsedSec === null) return;
    setIsSavingEarlyFinish(true);
    const saved = await saveMeditationSession(
      {
        mode: "BREATHING",
        breathingPattern: formatBreathingHistoryLabel(patternId, rhythm),
        plannedDurationSec: Math.round(totalDurationMs / 1000),
        actualDurationSec: earlyFinishElapsedSec,
        completed: false,
        note: noteInput.trim() || null,
        startedAt: sessionStartedAtRef.current ?? undefined,
        endedAt: new Date().toISOString(),
      },
      userId
    );
    setIsSavingEarlyFinish(false);
    if (saved) {
      onSessionSaved?.(saved);
    }
    resetToIdle();
  }, [
    earlyFinishElapsedSec,
    noteInput,
    onSessionSaved,
    patternId,
    resetToIdle,
    rhythm,
    totalDurationMs,
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

  const snapshot = useMemo(
    () => computeBreathingSnapshot(elapsedMs, rhythm),
    [elapsedMs, rhythm]
  );

  const remainingMs = Math.max(0, totalDurationMs - elapsedMs);
  const rhythmDisplay = formatBreathingRhythm(rhythm);
  const ambientName = m.sounds.ambient[ambientSound];

  const cuesSummary = hapticsEnabled
    ? `${m.breathing.cueModes[cueMode]} · ${m.breathing.hapticsShort}`
    : m.breathing.cueModes[cueMode];

  const isHoldPhase =
    snapshot.phase === "holdIn" || snapshot.phase === "holdOut";
  const outerScale = 0.72 + snapshot.orbScale * 0.34;
  const midScale = 0.78 + snapshot.orbScale * 0.26;
  const innerScale = 0.86 + snapshot.orbScale * 0.16;
  const arcOffset = ARC_CIRCUMFERENCE * (1 - snapshot.phaseProgress);

  return (
    <>
      {sessionPhase === "idle" && (
        <>
          {/* Organic Rhythm & Duration Dial */}
          <section className="flex flex-col items-center pt-1">
            <div className="relative flex h-44 w-44 flex-col items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] shadow-xs dark:border-white/10">
              <span className="text-[11px] font-medium tracking-[0.18em] text-[var(--foreground-muted)] uppercase">
                {m.breathing.rhythmLabel}
              </span>
              <span className="mt-1.5 font-mono text-2xl font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                {rhythmDisplay}
              </span>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDurationChange(durationMinutes - 1)}
                  disabled={durationMinutes <= MIN_BREATHING_DURATION_MINUTES}
                  aria-label={m.breathing.decreaseDurationAria}
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
                  disabled={durationMinutes >= MAX_BREATHING_DURATION_MINUTES}
                  aria-label={m.breathing.increaseDurationAria}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Single-row 4 Breathing Pattern Chips */}
            <div className="mt-5 grid w-full grid-cols-4 gap-1.5">
              {BREATHING_PATTERN_IDS.map((id) => {
                const isSelected = patternId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectPattern(id)}
                    className={`h-10 rounded-xl px-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                        : "border border-black/6 bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                    }`}
                  >
                    {m.breathing.patterns[id]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Compact 2-Row Settings Card */}
          <section className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-2xl border border-black/6 bg-[var(--surface)] dark:border-white/10">
              <div className="divide-y divide-black/5 dark:divide-white/8">
                <button
                  type="button"
                  onClick={() => setActiveBreathingSheet("cues")}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-muted)]/60 active:bg-[var(--surface-muted)]"
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-[var(--foreground)]">
                    <Wind className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                    {m.breathing.slotCues}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`truncate text-xs font-medium ${
                        cueMode === "silent" && !hapticsEnabled
                          ? "text-[var(--foreground-muted)]"
                          : "text-[var(--accent)]"
                      }`}
                    >
                      {cuesSummary}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]/70" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsSoundSheetOpen(true)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-muted)]/60 active:bg-[var(--surface-muted)]"
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-[var(--foreground)]">
                    <Volume2 className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                    {m.breathing.slotBackground}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`truncate text-xs font-medium tabular-nums ${
                        ambientSound === "silence"
                          ? "text-[var(--foreground-muted)]"
                          : "text-[var(--accent)]"
                      }`}
                    >
                      {ambientSound === "silence"
                        ? m.sounds.ambient.silence
                        : `${ambientName} · ${Math.round(ambientVolume * 100)}%`}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]/70" />
                  </span>
                </button>
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
              {m.breathing.beginBreathing}
            </button>
          </div>
        </>
      )}

      {(sessionPhase === "running" || sessionPhase === "paused") && (
        <div className="flex flex-1 flex-col items-center justify-between py-4">
          {/* Status Pill */}
          <div className="flex flex-col items-center gap-1.5">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3.5 py-1 text-xs font-medium tracking-wide text-[var(--accent)] uppercase tabular-nums">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isHoldPhase ? "bg-[var(--warm-amber)]" : "bg-[var(--accent)]"
                } ${sessionPhase === "running" ? "animate-pulse" : "opacity-50"}`}
              />
              {sessionPhase === "paused"
                ? m.timer.phasePaused
                : `${m.breathing.patterns[patternId]} · ${formatTimerDisplay(remainingMs)}`}
            </span>
            {isWakeLockActive && (
              <span className="text-[11px] text-[var(--foreground-muted)]">
                {m.timer.screenAwake}
              </span>
            )}
          </div>

          {/* Layered Organic Breathing Orb */}
          <div className="relative flex h-64 w-64 items-center justify-center">
            <div
              aria-hidden="true"
              style={{ transform: `scale(${outerScale.toFixed(3)})` }}
              className={`pointer-events-none absolute h-60 w-60 rounded-full transition-colors duration-500 ${
                isHoldPhase
                  ? "bg-[var(--warm-amber)]/12"
                  : "bg-[var(--accent)]/12"
              }`}
            />
            <div
              aria-hidden="true"
              style={{ transform: `scale(${midScale.toFixed(3)})` }}
              className={`pointer-events-none absolute h-48 w-48 rounded-full transition-colors duration-500 ${
                isHoldPhase
                  ? "bg-[var(--warm-amber)]/18"
                  : "bg-[var(--accent)]/18"
              }`}
            />
            <div
              aria-hidden="true"
              style={{ transform: `scale(${innerScale.toFixed(3)})` }}
              className={`pointer-events-none absolute h-40 w-40 rounded-full border transition-colors duration-500 ${
                isHoldPhase
                  ? "border-[var(--warm-amber)]/35 bg-[var(--surface)] shadow-sm"
                  : "border-[var(--accent)]/25 bg-[var(--surface)] shadow-sm"
              }`}
            />

            {/* Minimal phase progress arc */}
            <svg
              width={ARC_SIZE}
              height={ARC_SIZE}
              viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}
              className="pointer-events-none relative z-10 -rotate-90"
            >
              <circle
                cx={ARC_SIZE / 2}
                cy={ARC_SIZE / 2}
                r={ARC_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={ARC_STROKE}
                className="text-black/6 dark:text-white/10"
              />
              <circle
                cx={ARC_SIZE / 2}
                cy={ARC_SIZE / 2}
                r={ARC_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={ARC_STROKE}
                strokeLinecap="round"
                strokeDasharray={ARC_CIRCUMFERENCE}
                strokeDashoffset={arcOffset}
                className={
                  isHoldPhase
                    ? "text-[var(--warm-amber)]"
                    : "text-[var(--accent)]"
                }
              />
            </svg>

            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center text-center">
              <span className="text-base font-medium tracking-tight text-[var(--foreground)]">
                {m.breathing.phases[snapshot.phase]}
              </span>
              <span className="mt-0.5 font-mono text-4xl font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                {snapshot.phaseCountdownSec}
              </span>
              <span className="mt-1 text-[11px] text-[var(--foreground-muted)] tabular-nums">
                {m.breathing.cycleProgress(
                  Math.min(snapshot.cycleNumber, estimatedCycles),
                  estimatedCycles
                )}
              </span>
            </div>
          </div>

          {/* Active Session Controls */}
          <div className="flex w-full flex-col items-center gap-3">
            {earlyFinishElapsedSec === null && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {ambientSound !== "silence" && (
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
                        {m.timer.soundOn(ambientName)}
                      </>
                    )}
                  </button>
                )}

                {sessionPhase === "running" && (
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

            {isDimmed && sessionPhase === "running" && (
              <ZenDimOverlay
                primaryText={m.breathing.phases[snapshot.phase]}
                secondaryText={formatTimerDisplay(remainingMs)}
                breathingScale={snapshot.orbScale}
                monospace={false}
                onWake={() => setIsDimmed(false)}
              />
            )}

            {earlyFinishElapsedSec !== null ? (
              <EarlyFinishCard
                subtitle={m.breathing.breathedFor(
                  formatSessionDuration(earlyFinishElapsedSec)
                )}
                noteValue={noteInput}
                isSaving={isSavingEarlyFinish}
                onChangeNote={setNoteInput}
                onDiscard={resetToIdle}
                onSave={() => void handleSaveEarlyFinish()}
                onResume={handleResume}
              />
            ) : (
              <div className="grid w-full grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {m.timer.finish}
                </button>

                {sessionPhase === "paused" ? (
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

      {sessionPhase === "completed" && (
        <div className="flex flex-1 flex-col items-center justify-between gap-4 py-6 text-center">
          <div />

          <div className="flex w-full flex-col items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--accent-soft)]">
              <BodhiLogo className="h-11 w-11" />
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                {m.breathing.sessionComplete}
              </h1>
              <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
                {m.breathing.completedSummary(
                  formatDurationLabel(durationMinutes),
                  completedCycles,
                  m.breathing.patternNames[patternId]
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

          <div className="flex w-full flex-col gap-2.5">
            <div className="grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={resetToIdle}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
              >
                {m.timer.configure}
              </button>
              <button
                type="button"
                onClick={handleStart}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
              >
                <RotateCcw className="h-4 w-4" />
                {m.timer.repeat}
              </button>
            </div>

            {onContinueToMeditation && (
              <button
                type="button"
                onClick={() => {
                  resetToIdle();
                  onContinueToMeditation();
                }}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] shadow-xs transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
              >
                <Play className="h-4 w-4 fill-current" />
                {meditationOpenEnded
                  ? m.breathing.continueToOpenMeditation
                  : m.breathing.continueToMeditation(
                      `${meditationDurationMinutes}m`
                    )}
              </button>
            )}
          </div>
        </div>
      )}

      <BreathingSheet
        slot={sessionPhase === "idle" ? activeBreathingSheet : null}
        cueMode={cueMode}
        hapticsEnabled={hapticsEnabled}
        customRhythm={customRhythm}
        onClose={() => setActiveBreathingSheet(null)}
        onSelectCueMode={(mode) => updateBreathingPreferences({ cueMode: mode })}
        onPreviewCueMode={handlePreviewCue}
        onToggleHaptics={(enabled) =>
          updateBreathingPreferences({ hapticsEnabled: enabled })
        }
        onChangeCustomRhythm={(nextRhythm) =>
          updateBreathingPreferences({ customRhythm: nextRhythm })
        }
      />

      <SoundPickerSheet
        slot={sessionPhase === "idle" && isSoundSheetOpen ? "background" : null}
        ambientSound={ambientSound}
        ambientVolume={ambientVolume}
        previewingAmbientId={previewingAmbientId}
        onClose={() => {
          stopPreview();
          setIsSoundSheetOpen(false);
        }}
        onSelectAmbientSound={handleSelectAmbient}
        onChangeAmbientVolume={handleAmbientVolumeChange}
        onTogglePreviewAmbient={handleTogglePreviewAmbient}
      />
    </>
  );
}
