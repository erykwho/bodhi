"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
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
  SlidersHorizontal,
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
  getBreathingPreferencesServerSnapshot,
  getBreathingPreferencesSnapshot,
  subscribeBreathingPreferences,
  updateBreathingPreferences,
} from "@/lib/breathing/preferences";
import {
  clampRetentionRounds,
  computePowerBreathSnapshot,
  computeRecoverySnapshot,
  computeRetentionSummary,
  formatRetentionHistoryLabel,
  formatRetentionHoldCompact,
  resolveRetentionPaceRhythm,
} from "@/lib/breathing/retention-engine";
import {
  MAX_RETENTION_ROUNDS,
  MIN_RETENTION_ROUNDS,
  RECOVERY_EXHALE_SEC,
  RECOVERY_INHALE_SEC,
  RETENTION_PACE_IDS,
  type BreathingCueMode,
  type RetentionConfig,
  type RetentionPaceId,
  type RetentionStage,
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
import {
  clearMediaSession,
  setMediaSessionActionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "@/lib/media-session";
import { formatElapsedDisplay } from "@/lib/timer/engine";
import { useWakeLock } from "@/lib/wake-lock";

type RetentionSessionPhase = "idle" | "running" | "paused" | "completed";

const ARC_SIZE = 152;
const ARC_STROKE = 3;
const ARC_RADIUS = (ARC_SIZE - ARC_STROKE * 2) / 2;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;

function triggerHaptic(pattern: number | number[]): void {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.vibrate !== "function"
  ) {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore vibration permission or unsupported platform errors
  }
}

export interface RetentionBreathingProps {
  modeToggle: ReactNode;
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

export function RetentionBreathing({
  modeToggle,
  isAuthenticated = false,
  userId = null,
  meditationDurationMinutes,
  meditationOpenEnded,
  bellVolume,
  onSessionActiveChange,
  onSessionSaved,
  onSessionUpdated,
  onContinueToMeditation,
}: RetentionBreathingProps) {
  const { m } = useI18n();
  const prefs = useSyncExternalStore(
    subscribeBreathingPreferences,
    getBreathingPreferencesSnapshot,
    getBreathingPreferencesServerSnapshot
  );

  const {
    retention,
    customRhythm,
    cueMode,
    hapticsEnabled,
    ambientSound,
    ambientVolume,
  } = prefs;

  const {
    rounds: totalRounds,
    breathsPerRound,
    pace,
    recoveryHoldSec,
  } = retention;

  const paceRhythm = useMemo(() => resolveRetentionPaceRhythm(pace), [pace]);

  const [sessionPhase, setSessionPhase] =
    useState<RetentionSessionPhase>("idle");
  const [stage, setStage] = useState<RetentionStage>("power");
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [stageElapsedMs, setStageElapsedMs] = useState<number>(0);
  const [sessionElapsedMs, setSessionElapsedMs] = useState<number>(0);
  const [holdsSec, setHoldsSec] = useState<number[]>([]);
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
  const [completedDurationSec, setCompletedDurationSec] = useState<number>(0);
  const [noteInput, setNoteInput] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [noteSaved, setNoteSaved] = useState<boolean>(false);
  const [earlyFinishElapsedSec, setEarlyFinishElapsedSec] = useState<
    number | null
  >(null);
  const [isSavingEarlyFinish, setIsSavingEarlyFinish] =
    useState<boolean>(false);

  // Drift-free timing & synchronous state machine refs
  const segmentStartTimestampRef = useRef<number | null>(null);
  const accumulatedSessionMsRef = useRef<number>(0);
  const accumulatedStageMsRef = useRef<number>(0);
  const stageRef = useRef<RetentionStage>("power");
  const currentRoundRef = useRef<number>(1);
  const holdsSecRef = useRef<number[]>([]);
  const lastPowerStepRef = useRef<number>(-1);
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

  const { isActive: isWakeLockActive } = useWakeLock(
    sessionPhase === "running"
  );

  const getLiveDeltaMs = useCallback((now: number = Date.now()) => {
    if (segmentStartTimestampRef.current === null) return 0;
    return Math.max(0, now - segmentStartTimestampRef.current);
  }, []);

  const getLiveSessionElapsedMs = useCallback(
    (now: number = Date.now()) =>
      accumulatedSessionMsRef.current + getLiveDeltaMs(now),
    [getLiveDeltaMs]
  );

  const getLiveStageElapsedMs = useCallback(
    (now: number = Date.now()) =>
      accumulatedStageMsRef.current + getLiveDeltaMs(now),
    [getLiveDeltaMs]
  );

  const stopPreview = useCallback(() => {
    audioRef.current?.stopPreview();
    setPreviewingAmbientId(null);
  }, []);

  const transitionToStage = useCallback(
    (nextStage: RetentionStage, now: number) => {
      const liveSession = getLiveSessionElapsedMs(now);
      accumulatedSessionMsRef.current = liveSession;
      accumulatedStageMsRef.current = 0;
      segmentStartTimestampRef.current = now;
      stageRef.current = nextStage;
      setSessionElapsedMs(liveSession);
      setStageElapsedMs(0);
      setStage(nextStage);
    },
    [getLiveSessionElapsedMs]
  );

  const enterRetentionStage = useCallback(
    (now: number) => {
      transitionToStage("retention", now);

      const audio = getAudioEngine();
      audio.stopBreathingCue(0.15);
      if (cueMode !== "silent") {
        audio.playBellSound("singing-bowl", bellVolume * 0.55);
      }
      if (hapticsEnabled) {
        triggerHaptic([20, 60, 20]);
      }
    },
    [bellVolume, cueMode, getAudioEngine, hapticsEnabled, transitionToStage]
  );

  const handleCompleteSession = useCallback(
    (finalElapsedMs: number) => {
      const actualSec = Math.max(1, Math.round(finalElapsedMs / 1000));
      accumulatedSessionMsRef.current = finalElapsedMs;
      accumulatedStageMsRef.current = 0;
      segmentStartTimestampRef.current = null;

      setSessionElapsedMs(finalElapsedMs);
      setCompletedDurationSec(actualSec);
      setIsDimmed(false);
      setSessionPhase("completed");

      const audio = getAudioEngine();
      audio.stopBreathingCue(0.15);
      audio.stopAmbient(1.0);
      audio.playBellSound("soft-chime", bellVolume);
      if (hapticsEnabled) {
        triggerHaptic([24, 70, 24]);
      }

      if (isAuthenticated) {
        const patternLabel = formatRetentionHistoryLabel({
          completedRounds: totalRounds,
          totalRounds,
          breathsPerRound,
          holdsSec: holdsSecRef.current,
        });
        void saveMeditationSession(
          {
            mode: "BREATHING",
            breathingPattern: patternLabel,
            plannedDurationSec: null,
            actualDurationSec: actualSec,
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
    },
    [
      bellVolume,
      breathsPerRound,
      getAudioEngine,
      hapticsEnabled,
      isAuthenticated,
      onSessionSaved,
      totalRounds,
      userId,
    ]
  );

  // Drift-free animation frame loop driving power breaths, open retention, and recovery transitions
  useEffect(() => {
    if (sessionPhase !== "running") return;

    let frameId = 0;

    const tick = () => {
      const now = Date.now();
      const liveSession = getLiveSessionElapsedMs(now);
      const liveStage = getLiveStageElapsedMs(now);
      const activeStage = stageRef.current;

      if (activeStage === "power") {
        const snap = computePowerBreathSnapshot(
          liveStage,
          pace,
          breathsPerRound
        );

        if (snap.isComplete) {
          enterRetentionStage(now);
          frameId = window.requestAnimationFrame(tick);
          return;
        }

        if (snap.phaseStepIndex !== lastPowerStepRef.current) {
          lastPowerStepRef.current = snap.phaseStepIndex;
          getAudioEngine().playBreathingCue(
            snap.subPhase,
            cueMode,
            bellVolume,
            snap.phaseDurationMs / 1000
          );
          if (hapticsEnabled) {
            if (snap.isLastBreath && snap.subPhase === "exhale") {
              triggerHaptic([18, 45, 18]);
            } else if (snap.subPhase === "inhale") {
              triggerHaptic(20);
            } else {
              triggerHaptic(12);
            }
          }
        }
      } else if (activeStage === "recoveryInhale") {
        const snap = computeRecoverySnapshot(
          "recoveryInhale",
          liveStage,
          recoveryHoldSec
        );
        if (snap.isComplete) {
          transitionToStage("recoveryHold", now);
          getAudioEngine().stopBreathingCue(0.12);
          if (hapticsEnabled) {
            triggerHaptic(14);
          }
          frameId = window.requestAnimationFrame(tick);
          return;
        }
      } else if (activeStage === "recoveryHold") {
        const snap = computeRecoverySnapshot(
          "recoveryHold",
          liveStage,
          recoveryHoldSec
        );
        if (snap.isComplete) {
          transitionToStage("recoveryExhale", now);
          getAudioEngine().playBreathingCue(
            "exhale",
            cueMode,
            bellVolume,
            RECOVERY_EXHALE_SEC
          );
          if (hapticsEnabled) {
            triggerHaptic([16, 40, 16]);
          }
          frameId = window.requestAnimationFrame(tick);
          return;
        }
      } else if (activeStage === "recoveryExhale") {
        const snap = computeRecoverySnapshot(
          "recoveryExhale",
          liveStage,
          recoveryHoldSec
        );
        if (snap.isComplete) {
          if (currentRoundRef.current < totalRounds) {
            const nextRound = currentRoundRef.current + 1;
            currentRoundRef.current = nextRound;
            setCurrentRound(nextRound);
            lastPowerStepRef.current = 0;
            transitionToStage("power", now);

            const audio = getAudioEngine();
            audio.playBreathingCue(
              "inhale",
              cueMode,
              bellVolume,
              paceRhythm.inhaleSec
            );
            if (hapticsEnabled) {
              triggerHaptic(22);
            }
            frameId = window.requestAnimationFrame(tick);
            return;
          }

          handleCompleteSession(liveSession);
          return;
        }
      }

      setSessionElapsedMs(liveSession);
      setStageElapsedMs(liveStage);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    bellVolume,
    breathsPerRound,
    cueMode,
    enterRetentionStage,
    getAudioEngine,
    getLiveSessionElapsedMs,
    getLiveStageElapsedMs,
    handleCompleteSession,
    hapticsEnabled,
    pace,
    paceRhythm.inhaleSec,
    recoveryHoldSec,
    sessionPhase,
    totalRounds,
    transitionToStage,
  ]);

  const handleUpdateRetention = useCallback(
    (patch: Partial<RetentionConfig>) => {
      updateBreathingPreferences({
        retention: {
          ...retention,
          ...patch,
        },
      });
    },
    [retention]
  );

  const handleRoundsChange = useCallback(
    (nextRounds: number) => {
      handleUpdateRetention({ rounds: clampRetentionRounds(nextRounds) });
    },
    [handleUpdateRetention]
  );

  const handleSelectPace = useCallback(
    (nextPace: RetentionPaceId) => {
      handleUpdateRetention({ pace: nextPace });
    },
    [handleUpdateRetention]
  );

  const handlePreviewCue = useCallback(
    (mode: BreathingCueMode) => {
      const audio = getAudioEngine();
      audio.unlock({
        inhaleSec: paceRhythm.inhaleSec,
        exhaleSec: paceRhythm.exhaleSec,
        bells: mode === "chime" ? ["soft-chime"] : undefined,
      });
      audio.previewBreathingCue(
        mode,
        bellVolume,
        paceRhythm.inhaleSec,
        paceRhythm.exhaleSec
      );
    },
    [bellVolume, getAudioEngine, paceRhythm.exhaleSec, paceRhythm.inhaleSec]
  );

  const handleTogglePreviewAmbient = useCallback(
    (soundId: AmbientSoundId) => {
      const audio = getAudioEngine();
      audio.unlock({ ambientSound: soundId });

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
  }, [
    ambientSound,
    ambientVolume,
    getAudioEngine,
    isAmbientMuted,
    sessionPhase,
  ]);

  const handleStart = useCallback(() => {
    const audio = getAudioEngine();
    audio.unlock({
      inhaleSec: paceRhythm.inhaleSec,
      exhaleSec: paceRhythm.exhaleSec,
      bells: ["soft-chime", "singing-bowl"],
      ambientSound,
    });
    audio.stopBreathingCue(0.1);
    stopPreview();
    setActiveBreathingSheet(null);
    setIsSoundSheetOpen(false);
    setIsAmbientMuted(false);
    setIsDimmed(false);
    setSavedSessionId(null);
    setSavedSessionPending(false);
    setCompletedDurationSec(0);
    setNoteInput("");
    setNoteSaved(false);
    setEarlyFinishElapsedSec(null);

    const now = Date.now();
    accumulatedSessionMsRef.current = 0;
    accumulatedStageMsRef.current = 0;
    segmentStartTimestampRef.current = now;
    stageRef.current = "power";
    currentRoundRef.current = 1;
    holdsSecRef.current = [];
    lastPowerStepRef.current = 0;
    sessionStartedAtRef.current = new Date(now).toISOString();

    setStage("power");
    setCurrentRound(1);
    setHoldsSec([]);
    setStageElapsedMs(0);
    setSessionElapsedMs(0);
    setSessionPhase("running");

    audio.playBreathingCue(
      "inhale",
      cueMode,
      bellVolume,
      paceRhythm.inhaleSec
    );
    if (hapticsEnabled) {
      triggerHaptic(22);
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
    paceRhythm.exhaleSec,
    paceRhythm.inhaleSec,
    stopPreview,
  ]);

  const handleSkipToHold = useCallback(() => {
    if (sessionPhase !== "running" || stageRef.current !== "power") return;
    enterRetentionStage(Date.now());
  }, [enterRetentionStage, sessionPhase]);

  const handleEndRetention = useCallback(() => {
    if (sessionPhase !== "running" || stageRef.current !== "retention") return;
    const now = Date.now();
    const holdMs = getLiveStageElapsedMs(now);
    const holdSec = Math.max(1, Math.round(holdMs / 1000));
    const nextHolds = [...holdsSecRef.current, holdSec];
    holdsSecRef.current = nextHolds;
    setHoldsSec(nextHolds);

    transitionToStage("recoveryInhale", now);

    const audio = getAudioEngine();
    audio.playBreathingCue("inhale", cueMode, bellVolume, RECOVERY_INHALE_SEC);
    if (hapticsEnabled) {
      triggerHaptic(28);
    }
  }, [
    bellVolume,
    cueMode,
    getAudioEngine,
    getLiveStageElapsedMs,
    hapticsEnabled,
    sessionPhase,
    transitionToStage,
  ]);

  const handlePause = useCallback(() => {
    if (sessionPhase !== "running") return;
    const now = Date.now();
    const liveSession = getLiveSessionElapsedMs(now);
    const liveStage = getLiveStageElapsedMs(now);
    accumulatedSessionMsRef.current = liveSession;
    accumulatedStageMsRef.current = liveStage;
    segmentStartTimestampRef.current = null;
    setSessionElapsedMs(liveSession);
    setStageElapsedMs(liveStage);
    setIsDimmed(false);
    setSessionPhase("paused");
    audioRef.current?.stopBreathingCue(0.2);
    audioRef.current?.stopAmbient(0.4);
  }, [getLiveSessionElapsedMs, getLiveStageElapsedMs, sessionPhase]);

  const handleResume = useCallback(() => {
    if (sessionPhase !== "paused") return;
    const audio = getAudioEngine();
    audio.unlock({
      inhaleSec: paceRhythm.inhaleSec,
      exhaleSec: paceRhythm.exhaleSec,
      bells: ["soft-chime", "singing-bowl"],
      ambientSound,
    });
    setEarlyFinishElapsedSec(null);
    segmentStartTimestampRef.current = Date.now();
    setSessionPhase("running");

    const activeStage = stageRef.current;
    if (activeStage === "power") {
      const snap = computePowerBreathSnapshot(
        accumulatedStageMsRef.current,
        pace,
        breathsPerRound
      );
      if (!snap.isComplete && snap.phaseRemainingMs >= 400) {
        audio.playBreathingCue(
          snap.subPhase,
          cueMode,
          bellVolume,
          snap.phaseRemainingMs / 1000
        );
      }
    } else if (
      activeStage === "recoveryInhale" ||
      activeStage === "recoveryExhale"
    ) {
      const snap = computeRecoverySnapshot(
        activeStage,
        accumulatedStageMsRef.current,
        recoveryHoldSec
      );
      if (!snap.isComplete && snap.remainingMs >= 400) {
        audio.playBreathingCue(
          activeStage === "recoveryInhale" ? "inhale" : "exhale",
          cueMode,
          bellVolume,
          snap.remainingMs / 1000
        );
      }
    }

    if (ambientSound !== "silence" && !isAmbientMuted) {
      audio.startAmbient(ambientSound, ambientVolume, 0.7);
    }
  }, [
    ambientSound,
    ambientVolume,
    bellVolume,
    breathsPerRound,
    cueMode,
    getAudioEngine,
    isAmbientMuted,
    pace,
    paceRhythm.exhaleSec,
    paceRhythm.inhaleSec,
    recoveryHoldSec,
    sessionPhase,
  ]);

  const resetToIdle = useCallback(() => {
    segmentStartTimestampRef.current = null;
    accumulatedSessionMsRef.current = 0;
    accumulatedStageMsRef.current = 0;
    stageRef.current = "power";
    currentRoundRef.current = 1;
    holdsSecRef.current = [];
    lastPowerStepRef.current = -1;
    sessionStartedAtRef.current = null;

    audioRef.current?.stopBreathingCue(0.15);
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
    setStage("power");
    setCurrentRound(1);
    setHoldsSec([]);
    setStageElapsedMs(0);
    setSessionElapsedMs(0);
    setSessionPhase("idle");
  }, [stopPreview]);

  const handleFinish = useCallback(() => {
    const now = Date.now();
    const liveSession = getLiveSessionElapsedMs(now);
    const liveStage = getLiveStageElapsedMs(now);
    const elapsedSec = Math.floor(liveSession / 1000);

    if (isAuthenticated && elapsedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
      accumulatedSessionMsRef.current = liveSession;
      accumulatedStageMsRef.current = liveStage;
      segmentStartTimestampRef.current = null;
      setSessionElapsedMs(liveSession);
      setStageElapsedMs(liveStage);
      setIsDimmed(false);
      setSessionPhase("paused");
      audioRef.current?.stopBreathingCue(0.2);
      audioRef.current?.stopAmbient(0.4);
      setEarlyFinishElapsedSec(elapsedSec);
      return;
    }

    resetToIdle();
  }, [
    getLiveSessionElapsedMs,
    getLiveStageElapsedMs,
    isAuthenticated,
    resetToIdle,
  ]);

  // Unified Media Session API for Retention Breathing
  const isSessionOpen =
    sessionPhase === "running" || sessionPhase === "paused";

  useEffect(() => {
    if (!isSessionOpen) {
      clearMediaSession();
      return;
    }

    setMediaSessionMetadata({
      title: m.breathing.mediaRetentionTitle(currentRound, totalRounds),
      artist:
        ambientSound !== "silence"
          ? m.sounds.ambient[ambientSound]
          : m.mediaSession.artist,
      album: "Bodhi",
    });
    setMediaSessionPlaybackState(
      sessionPhase === "paused" ? "paused" : "playing"
    );
    setMediaSessionPositionState(null);
    setMediaSessionActionHandlers({
      onPlay: handleResume,
      onPause: handlePause,
      onStop: handleFinish,
    });

    return () => {
      clearMediaSession();
    };
  }, [
    ambientSound,
    currentRound,
    handleFinish,
    handlePause,
    handleResume,
    isSessionOpen,
    m.breathing,
    m.mediaSession.artist,
    m.sounds.ambient,
    sessionPhase,
    totalRounds,
  ]);

  const handleSaveEarlyFinish = useCallback(async () => {
    if (earlyFinishElapsedSec === null) return;
    setIsSavingEarlyFinish(true);

    // If finishing mid-retention with >= 5s held, include that hold in the summary
    const recordedHolds = [...holdsSecRef.current];
    if (stageRef.current === "retention") {
      const currentHoldSec = Math.round(accumulatedStageMsRef.current / 1000);
      if (currentHoldSec >= 5) {
        recordedHolds.push(currentHoldSec);
      }
    }

    const patternLabel = formatRetentionHistoryLabel({
      completedRounds: recordedHolds.length,
      totalRounds,
      breathsPerRound,
      holdsSec: recordedHolds,
    });

    const saved = await saveMeditationSession(
      {
        mode: "BREATHING",
        breathingPattern: patternLabel,
        plannedDurationSec: null,
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
    breathsPerRound,
    earlyFinishElapsedSec,
    noteInput,
    onSessionSaved,
    resetToIdle,
    totalRounds,
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

  // Derived visual state for active session orb
  const powerSnap = useMemo(
    () => computePowerBreathSnapshot(stageElapsedMs, pace, breathsPerRound),
    [breathsPerRound, pace, stageElapsedMs]
  );

  const recoverySnap = useMemo(
    () =>
      stage === "recoveryInhale" ||
      stage === "recoveryHold" ||
      stage === "recoveryExhale"
        ? computeRecoverySnapshot(stage, stageElapsedMs, recoveryHoldSec)
        : null,
    [recoveryHoldSec, stage, stageElapsedMs]
  );

  const retentionStats = useMemo(
    () => computeRetentionSummary(holdsSec),
    [holdsSec]
  );

  const isAmberStage = stage === "retention" || stage === "recoveryHold";

  let orbScale = 0;
  let arcProgress = 0;
  let orbPrimaryLabel = "";
  let orbCenterValue = "";
  let orbHint: string | null = null;

  if (stage === "power") {
    orbScale = powerSnap.orbScale;
    arcProgress = powerSnap.breathNumber / powerSnap.totalBreaths;
    orbPrimaryLabel = m.breathing.phases[powerSnap.subPhase];
    orbCenterValue = m.breathing.breathProgress(
      powerSnap.breathNumber,
      powerSnap.totalBreaths
    );
    orbHint = powerSnap.isLastBreath ? m.breathing.lastBreathHint : null;
  } else if (stage === "retention") {
    orbScale = 0;
    arcProgress = (stageElapsedMs % 60_000) / 60_000;
    orbPrimaryLabel = m.breathing.stageHoldEmpty;
    orbCenterValue = formatElapsedDisplay(stageElapsedMs);
    orbHint = m.breathing.holdTapHint;
  } else if (recoverySnap) {
    orbScale = recoverySnap.orbScale;
    arcProgress = recoverySnap.progress;
    if (stage === "recoveryInhale") {
      orbPrimaryLabel = m.breathing.stageRecoveryInhale;
      orbCenterValue = `${recoverySnap.countdownSec}`;
    } else if (stage === "recoveryHold") {
      orbPrimaryLabel = m.breathing.stageRecoveryHold;
      orbCenterValue = `${recoverySnap.countdownSec}`;
    } else {
      orbPrimaryLabel = m.breathing.stageRecoveryExhale;
      orbCenterValue = `${recoverySnap.countdownSec}`;
    }
  }

  const outerScale = 0.72 + orbScale * 0.34;
  const midScale = 0.78 + orbScale * 0.26;
  const innerScale = 0.86 + orbScale * 0.16;
  const arcOffset = ARC_CIRCUMFERENCE * (1 - arcProgress);

  const ambientName = m.sounds.ambient[ambientSound];
  const cuesSummary = hapticsEnabled
    ? `${m.breathing.cueModes[cueMode]} · ${m.breathing.hapticsShort}`
    : m.breathing.cueModes[cueMode];

  const isRetentionTapTarget =
    stage === "retention" &&
    sessionPhase === "running" &&
    earlyFinishElapsedSec === null;

  return (
    <>
      {sessionPhase === "idle" && (
        <div className="flex flex-1 flex-col gap-3.5">
          {/* Organic Retention Rounds Dial (locked to exact same Y-position as Timer/Rhythmic) */}
          <section className="flex flex-col items-center pt-1">
            <div className="relative flex h-44 w-44 flex-col items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] px-3 shadow-xs dark:border-white/10">
              <span className="text-[11px] font-medium tracking-[0.18em] text-[var(--foreground-muted)] uppercase">
                {m.breathing.retentionLabel}
              </span>
              <span
                aria-label={`${totalRounds} × ${breathsPerRound}`}
                className="mt-1 inline-flex items-center justify-center whitespace-nowrap font-mono text-[24px] leading-tight font-medium tracking-tight text-[var(--foreground)] tabular-nums"
              >
                {totalRounds}
                <span
                  aria-hidden="true"
                  className="px-1.5 text-base text-[var(--foreground-muted)]/60"
                >
                  ×
                </span>
                {breathsPerRound}
              </span>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRoundsChange(totalRounds - 1)}
                  disabled={totalRounds <= MIN_RETENTION_ROUNDS}
                  aria-label={m.breathing.decreaseRoundsAria}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[3.75rem] text-center text-xs font-medium text-[var(--foreground-muted)] tabular-nums">
                  {m.breathing.roundsCount(totalRounds)}
                </span>
                <button
                  type="button"
                  onClick={() => handleRoundsChange(totalRounds + 1)}
                  disabled={totalRounds >= MAX_RETENTION_ROUNDS}
                  aria-label={m.breathing.increaseRoundsAria}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Rhythmic | Retention switcher directly below the dial */}
            <div className="mt-3.5">{modeToggle}</div>

            {/* Single-row 3 Pace Chips */}
            <div className="mt-3 grid w-full grid-cols-3 gap-1.5">
              {RETENTION_PACE_IDS.map((paceId) => {
                const isSelected = pace === paceId;
                return (
                  <button
                    key={paceId}
                    type="button"
                    onClick={() => handleSelectPace(paceId)}
                    className={`h-10 rounded-xl px-2 text-xs font-medium whitespace-nowrap transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                        : "border border-black/6 bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                    }`}
                  >
                    {m.breathing.paceLabels[paceId]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Compact 3-Row Settings Card */}
          <section className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-2xl border border-black/6 bg-[var(--surface)] dark:border-white/10">
              <div className="divide-y divide-black/5 dark:divide-white/8">
                <button
                  type="button"
                  onClick={() => setActiveBreathingSheet("retention")}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-muted)]/60 active:bg-[var(--surface-muted)]"
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-[var(--foreground)]">
                    <SlidersHorizontal className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
                    {m.breathing.slotProtocol}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-[var(--accent)] tabular-nums">
                      {m.breathing.protocolSummary(
                        breathsPerRound,
                        recoveryHoldSec
                      )}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]/70" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveBreathingSheet("cues")}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-muted)]/60 active:bg-[var(--surface-muted)]"
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
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-muted)]/60 active:bg-[var(--surface-muted)]"
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

            <p className="px-1 text-center text-[11px] text-[var(--foreground-muted)]">
              {m.breathing.safetyNoticeShort}
            </p>
          </section>

          {/* Primary CTA */}
          <div className="mt-auto pt-0.5">
            <button
              type="button"
              onClick={handleStart}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-base font-semibold text-[#fcfaf6] shadow-xs transition-colors hover:bg-[var(--accent-strong)] active:scale-[0.99] dark:text-[#151917]"
            >
              <Play className="h-4 w-4 fill-current" />
              {m.breathing.beginRetention}
            </button>
          </div>
        </div>
      )}

      {(sessionPhase === "running" || sessionPhase === "paused") && (
        <div className="flex flex-1 flex-col items-center justify-between py-4">
          {/* Status Pill */}
          <div className="flex flex-col items-center gap-1.5">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3.5 py-1 text-xs font-medium tracking-wide text-[var(--accent)] uppercase tabular-nums">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isAmberStage
                    ? "bg-[var(--warm-amber)]"
                    : "bg-[var(--accent)]"
                } ${sessionPhase === "running" ? "animate-pulse" : "opacity-50"}`}
              />
              {sessionPhase === "paused"
                ? m.timer.phasePaused
                : `${m.breathing.roundProgress(currentRound, totalRounds)} · ${formatElapsedDisplay(sessionElapsedMs)}`}
            </span>
            {isWakeLockActive && (
              <span className="text-[11px] text-[var(--foreground-muted)]">
                {m.timer.screenAwake}
              </span>
            )}
          </div>

          {/* Layered Organic Breathing Orb + external hint caption */}
          <div className="flex flex-col items-center gap-2">
            <div
              role={isRetentionTapTarget ? "button" : undefined}
              tabIndex={isRetentionTapTarget ? 0 : undefined}
              aria-label={
                isRetentionTapTarget ? m.breathing.inhaleAndRecover : undefined
              }
              onClick={isRetentionTapTarget ? handleEndRetention : undefined}
              onKeyDown={
                isRetentionTapTarget
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleEndRetention();
                      }
                    }
                  : undefined
              }
              className={`relative flex h-64 w-64 items-center justify-center ${
                isRetentionTapTarget ? "cursor-pointer select-none" : ""
              }`}
            >
              <div
                aria-hidden="true"
                style={{ transform: `scale(${outerScale.toFixed(3)})` }}
                className={`pointer-events-none absolute h-60 w-60 rounded-full transition-colors duration-500 ${
                  isAmberStage
                    ? "bg-[var(--warm-amber)]/12"
                    : "bg-[var(--accent)]/12"
                }`}
              />
              <div
                aria-hidden="true"
                style={{ transform: `scale(${midScale.toFixed(3)})` }}
                className={`pointer-events-none absolute h-48 w-48 rounded-full transition-colors duration-500 ${
                  isAmberStage
                    ? "bg-[var(--warm-amber)]/18"
                    : "bg-[var(--accent)]/18"
                }`}
              />
              <div
                aria-hidden="true"
                style={{ transform: `scale(${innerScale.toFixed(3)})` }}
                className={`pointer-events-none absolute h-40 w-40 rounded-full border transition-colors duration-500 ${
                  isAmberStage
                    ? "border-[var(--warm-amber)]/35 bg-[var(--surface)] shadow-sm"
                    : "border-[var(--accent)]/25 bg-[var(--surface)] shadow-sm"
                }`}
              />

              {/* Minimal progress arc */}
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
                    isAmberStage
                      ? "text-[var(--warm-amber)]"
                      : "text-[var(--accent)]"
                  }
                />
              </svg>

              <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center text-center">
                <span className="max-w-[116px] text-sm leading-tight font-medium tracking-tight text-[var(--foreground)]">
                  {orbPrimaryLabel}
                </span>
                <span
                  className={`mt-1 font-mono font-medium tracking-tight text-[var(--foreground)] tabular-nums ${
                    stage === "power" ? "text-2xl" : "text-3xl"
                  }`}
                >
                  {orbCenterValue}
                </span>
              </div>
            </div>

            <p className="min-h-5 px-4 text-center text-xs text-[var(--foreground-muted)]">
              {orbHint ?? ""}
            </p>
          </div>

          {/* Recorded round holds strip (appears once round 1 hold is done) */}
          {holdsSec.length > 0 && earlyFinishElapsedSec === null && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {holdsSec.map((sec, idx) => (
                <span
                  key={`${idx}-${sec}`}
                  className="rounded-full border border-black/6 bg-[var(--surface)] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[var(--foreground-muted)] tabular-nums dark:border-white/10"
                >
                  {m.breathing.roundHoldTag(
                    idx + 1,
                    formatRetentionHoldCompact(sec)
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Active Session Controls */}
          <div className="flex w-full flex-col items-center gap-3">
            {earlyFinishElapsedSec === null && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {stage === "power" && sessionPhase === "running" && (
                  <button
                    type="button"
                    onClick={handleSkipToHold}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warm-amber)]/30 bg-[var(--warm-amber)]/10 px-3.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--warm-amber)]/18"
                  >
                    {m.breathing.skipToHold}
                  </button>
                )}

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
                primaryText={
                  stage === "retention"
                    ? formatElapsedDisplay(stageElapsedMs)
                    : orbPrimaryLabel
                }
                secondaryText={
                  stage === "retention"
                    ? `${m.breathing.stageHoldEmpty} · ${m.breathing.roundProgress(currentRound, totalRounds)}`
                    : `${m.breathing.roundProgress(currentRound, totalRounds)} · ${orbCenterValue}`
                }
                breathingScale={orbScale}
                monospace={stage === "retention"}
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
              <div className="flex w-full flex-col gap-2.5">
                {isRetentionTapTarget && (
                  <button
                    type="button"
                    onClick={handleEndRetention}
                    className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-base font-semibold text-[#fcfaf6] shadow-xs transition-colors hover:bg-[var(--accent-strong)] active:scale-[0.99] dark:text-[#151917]"
                  >
                    <Wind className="h-4 w-4" />
                    {m.breathing.inhaleAndRecover}
                  </button>
                )}

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
                      className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-colors ${
                        isRetentionTapTarget
                          ? "border border-black/8 bg-[var(--surface)] font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)] dark:border-white/10"
                          : "bg-[var(--accent)] text-[#fcfaf6] hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                      }`}
                    >
                      <Pause className="h-4 w-4 fill-current" />
                      {m.timer.pause}
                    </button>
                  )}
                </div>
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
                {m.breathing.retentionCompletedSummary(
                  formatSessionDuration(completedDurationSec),
                  totalRounds
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

            {/* Per-round retention hold breakdown */}
            {retentionStats.count > 0 && (
              <div className="w-full rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {holdsSec.map((sec, idx) => {
                    const isBest =
                      sec === retentionStats.longestSec && holdsSec.length > 1;
                    return (
                      <span
                        key={`${idx}-${sec}`}
                        className={`rounded-full px-2.5 py-1 font-mono text-xs font-medium tabular-nums ${
                          isBest
                            ? "bg-[var(--warm-amber)]/18 text-[var(--foreground)] ring-1 ring-[var(--warm-amber)]/35"
                            : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]"
                        }`}
                      >
                        {m.breathing.roundHoldTag(
                          idx + 1,
                          formatRetentionHoldCompact(sec)
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-2.5 flex items-center justify-center gap-3 text-xs text-[var(--foreground-muted)] tabular-nums">
                  <span className="font-medium text-[var(--foreground)]">
                    {m.breathing.bestHoldLabel(
                      formatRetentionHoldCompact(retentionStats.longestSec)
                    )}
                  </span>
                  {retentionStats.count > 1 && (
                    <>
                      <span>·</span>
                      <span>
                        {m.breathing.avgHoldLabel(
                          formatRetentionHoldCompact(retentionStats.averageSec)
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

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
        retentionConfig={retention}
        onClose={() => {
          audioRef.current?.stopBreathingCue(0.15);
          setActiveBreathingSheet(null);
        }}
        onSelectCueMode={(mode) => updateBreathingPreferences({ cueMode: mode })}
        onPreviewCueMode={handlePreviewCue}
        onToggleHaptics={(enabled) =>
          updateBreathingPreferences({ hapticsEnabled: enabled })
        }
        onChangeCustomRhythm={(nextRhythm) =>
          updateBreathingPreferences({ customRhythm: nextRhythm })
        }
        onChangeRetentionConfig={(nextRetention) =>
          updateBreathingPreferences({ retention: nextRetention })
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
