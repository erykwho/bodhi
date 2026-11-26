import { useKeepAwake } from "expo-keep-awake";
import { EyeOff, Pause, Play, Square } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  computeBreathingSnapshot,
  formatBreathingHistoryLabel,
  resolveBreathingRhythm,
} from "@bodhi/core/breathing/engine";
import {
  computePowerBreathSnapshot,
  computeRetentionSummary,
  formatRetentionHistoryLabel,
  formatRetentionHoldCompact,
  resolveRetentionPaceRhythm,
} from "@bodhi/core/breathing/retention-engine";
import {
  BREATHING_CUE_MODES,
  BREATHING_PATTERN_IDS,
  RECOVERY_EXHALE_SEC,
  RECOVERY_INHALE_SEC,
  RETENTION_BREATH_PRESETS,
  RETENTION_PACE_IDS,
  type BreathingCueMode,
  type BreathingPhase,
  type RetentionStage,
} from "@bodhi/core/breathing/types";
import { MIN_SAVEABLE_EARLY_STOP_SECONDS } from "@bodhi/core/history/stats";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import {
  formatElapsedDisplay,
  formatTimerDisplay,
} from "@bodhi/core/timer/engine";
import { nativeAudioEngine } from "../../platform/audio/native-engine";
import {
  triggerBellHaptic,
  triggerBreathPhaseHaptic,
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import { breathingPreferencesStore } from "../../platform/storage";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";
import { EarlyFinishCard } from "../common/EarlyFinishCard";
import { ZenDimOverlay } from "../common/ZenDimOverlay";
import { PracticeDial } from "../timer/PracticeDial";

interface BreathingViewProps {
  onContinueToMeditation: () => void;
}

const BREATHING_DURATIONS = [1, 3, 5, 10] as const;

export function BreathingView({ onContinueToMeditation }: BreathingViewProps) {
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const { saveSession } = useBodhiData();

  const prefs = useSyncExternalStore(
    breathingPreferencesStore.subscribe,
    breathingPreferencesStore.getSnapshot,
    breathingPreferencesStore.getDefaultSnapshot
  );

  const [status, setStatus] = useState<"idle" | "running" | "paused" | "completed">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [zenDim, setZenDim] = useState(false);
  const [showEarlyFinish, setShowEarlyFinish] = useState(false);

  // Retention state machine
  const [roundIndex, setRoundIndex] = useState(1);
  const [stage, setStage] = useState<RetentionStage>("power");
  const [stageElapsedMs, setStageElapsedMs] = useState(0);
  const [roundHoldsSec, setRoundHoldsSec] = useState<number[]>([]);

  const startEpochRef = useRef<number>(0);
  const stageStartEpochRef = useRef<number>(0);
  const lastStepIndexRef = useRef<number>(-1);
  const sessionStartedIsoRef = useRef<string>("");

  useKeepAwake(status === "running" ? "bodhi-breathing" : undefined);

  const isRetention = prefs.mode === "retention";
  const totalRhythmicMs = prefs.durationMinutes * 60 * 1000;
  const rhythm = resolveBreathingRhythm(prefs.patternId, prefs.customRhythm);
  const paceRhythm = resolveRetentionPaceRhythm(prefs.retention.pace);

  const phaseLabel = useCallback(
    (phase: BreathingPhase): string => {
      switch (phase) {
        case "inhale":
          return m.breathing.phases.inhale;
        case "holdIn":
          return m.breathing.phases.holdIn;
        case "exhale":
          return m.breathing.phases.exhale;
        case "holdOut":
          return m.breathing.phases.holdOut;
      }
    },
    [m]
  );

  const stopAllAudio = useCallback(() => {
    nativeAudioEngine.stopBreathingCue(0.15);
    nativeAudioEngine.stopAmbient(0.6);
    nativeAudioEngine.stopBackgroundKeepAlive();
    nativeAudioEngine.clearLockScreen();
  }, []);

  const finishAndSave = useCallback(
    async (completed: boolean, actualSec: number, holds: number[] = roundHoldsSec) => {
      stopAllAudio();
      setZenDim(false);
      setStatus("completed");
      triggerSuccessHaptic();
      nativeAudioEngine.playBell("end", 0.8);

      const patternLabel = isRetention
        ? formatRetentionHistoryLabel({
            completedRounds: holds.length,
            totalRounds: prefs.retention.rounds,
            breathsPerRound: prefs.retention.breathsPerRound,
            holdsSec: holds,
          })
        : formatBreathingHistoryLabel(prefs.patternId, rhythm);

      await saveSession({
        mode: "BREATHING",
        breathingPattern: patternLabel,
        plannedDurationSec: isRetention ? null : prefs.durationMinutes * 60,
        actualDurationSec: Math.max(1, actualSec),
        completed,
        startedAt: sessionStartedIsoRef.current || undefined,
      });
    },
    [
      isRetention,
      prefs.durationMinutes,
      prefs.patternId,
      prefs.retention,
      rhythm,
      roundHoldsSec,
      saveSession,
      stopAllAudio,
    ]
  );

  const startSession = () => {
    triggerBellHaptic();
    const now = Date.now();
    sessionStartedIsoRef.current = new Date(now).toISOString();
    startEpochRef.current = now;
    stageStartEpochRef.current = now;
    lastStepIndexRef.current = -1;

    setElapsedMs(0);
    setRoundIndex(1);
    setStage("power");
    setStageElapsedMs(0);
    setRoundHoldsSec([]);
    setStatus("running");

    nativeAudioEngine.unlock({
      inhaleSec: isRetention ? paceRhythm.inhaleSec : rhythm.inhaleSec,
      exhaleSec: isRetention ? paceRhythm.exhaleSec : rhythm.exhaleSec,
      ambientSound: prefs.ambientSound,
    });
    if (prefs.ambientSound !== "silence") {
      nativeAudioEngine.startAmbient(prefs.ambientSound, prefs.ambientVolume);
    } else {
      nativeAudioEngine.startBackgroundKeepAlive();
    }
    nativeAudioEngine.updateLockScreen({
      title: isRetention
        ? m.breathing.modeRetention
        : m.breathing.patternNames[prefs.patternId],
      state: "playing",
      durationSec: isRetention ? undefined : prefs.durationMinutes * 60,
    });
  };

  const pauseSession = () => {
    setStatus("paused");
    nativeAudioEngine.stopBreathingCue(0.1);
    nativeAudioEngine.stopAmbient(0.3);
    nativeAudioEngine.updateLockScreen({
      title: isRetention
        ? m.breathing.modeRetention
        : m.breathing.patternNames[prefs.patternId],
      state: "paused",
    });
  };

  const resumeSession = () => {
    const now = Date.now();
    startEpochRef.current = now - elapsedMs;
    stageStartEpochRef.current = now - stageElapsedMs;
    setStatus("running");
    if (prefs.ambientSound !== "silence") {
      nativeAudioEngine.startAmbient(prefs.ambientSound, prefs.ambientVolume);
    } else {
      nativeAudioEngine.startBackgroundKeepAlive();
    }
  };

  const handleRequestFinish = () => {
    const elapsedSec = Math.floor(elapsedMs / 1000);
    if (elapsedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
      pauseSession();
      setShowEarlyFinish(true);
    } else {
      stopAllAudio();
      setStatus("idle");
      setElapsedMs(0);
    }
  };

  const triggerRetentionRecovery = () => {
    if (!isRetention || status !== "running" || stage !== "retention") return;
    const heldSec = Math.max(1, Math.round(stageElapsedMs / 1000));
    setRoundHoldsSec((prev) => [...prev, heldSec]);
    stageStartEpochRef.current = Date.now();
    lastStepIndexRef.current = -1;
    setStage("recoveryInhale");
    setStageElapsedMs(0);
    triggerBreathPhaseHaptic("inhale", prefs.hapticsEnabled);
    nativeAudioEngine.playBreathingCue(
      "inhale",
      prefs.cueMode,
      0.85,
      RECOVERY_INHALE_SEC
    );
  };

  // Main animation/tick loop (timestamp-based, drift-free)
  useEffect(() => {
    if (status !== "running") return;

    const timer = setInterval(() => {
      const now = Date.now();
      const totalElapsed = now - startEpochRef.current;
      setElapsedMs(totalElapsed);

      if (!isRetention) {
        if (totalElapsed >= totalRhythmicMs) {
          void finishAndSave(true, Math.round(totalRhythmicMs / 1000));
          return;
        }
        const snap = computeBreathingSnapshot(totalElapsed, rhythm);
        if (snap.phaseStepIndex !== lastStepIndexRef.current) {
          lastStepIndexRef.current = snap.phaseStepIndex;
          triggerBreathPhaseHaptic(snap.phase, prefs.hapticsEnabled);
          nativeAudioEngine.playBreathingCue(
            snap.phase,
            prefs.cueMode,
            0.85,
            snap.phaseDurationMs / 1000
          );
        }
      } else {
        const sElapsed = now - stageStartEpochRef.current;
        setStageElapsedMs(sElapsed);

        if (stage === "power") {
          const pSnap = computePowerBreathSnapshot(
            sElapsed,
            prefs.retention.pace,
            prefs.retention.breathsPerRound
          );
          if (pSnap.isComplete) {
            stageStartEpochRef.current = now;
            setStage("retention");
            setStageElapsedMs(0);
            triggerBreathPhaseHaptic("holdOut", prefs.hapticsEnabled);
            return;
          }
          if (pSnap.phaseStepIndex !== lastStepIndexRef.current) {
            lastStepIndexRef.current = pSnap.phaseStepIndex;
            triggerBreathPhaseHaptic(pSnap.subPhase, prefs.hapticsEnabled);
            nativeAudioEngine.playBreathingCue(
              pSnap.subPhase,
              prefs.cueMode,
              0.8,
              pSnap.phaseDurationMs / 1000
            );
          }
        } else if (stage === "recoveryInhale") {
          if (sElapsed >= RECOVERY_INHALE_SEC * 1000) {
            stageStartEpochRef.current = now;
            setStage("recoveryHold");
            setStageElapsedMs(0);
            triggerBreathPhaseHaptic("holdIn", prefs.hapticsEnabled);
          }
        } else if (stage === "recoveryHold") {
          if (sElapsed >= prefs.retention.recoveryHoldSec * 1000) {
            stageStartEpochRef.current = now;
            setStage("recoveryExhale");
            setStageElapsedMs(0);
            triggerBreathPhaseHaptic("exhale", prefs.hapticsEnabled);
            nativeAudioEngine.playBreathingCue(
              "exhale",
              prefs.cueMode,
              0.85,
              RECOVERY_EXHALE_SEC
            );
          }
        } else if (stage === "recoveryExhale") {
          if (sElapsed >= RECOVERY_EXHALE_SEC * 1000) {
            if (roundIndex >= prefs.retention.rounds) {
              void finishAndSave(true, Math.round(totalElapsed / 1000));
            } else {
              setRoundIndex((r) => r + 1);
              stageStartEpochRef.current = now;
              lastStepIndexRef.current = -1;
              setStage("power");
              setStageElapsedMs(0);
            }
          }
        }
      }
    }, 60);

    return () => clearInterval(timer);
  }, [
    finishAndSave,
    isRetention,
    paceRhythm,
    prefs.cueMode,
    prefs.hapticsEnabled,
    prefs.retention,
    rhythm,
    roundIndex,
    stage,
    status,
    totalRhythmicMs,
  ]);

  useEffect(() => {
    return () => stopAllAudio();
  }, [stopAllAudio]);

  // Compute dial visuals
  let dialProgress = 0;
  let dialPrimary = `${prefs.durationMinutes}:00`;
  let dialSecondary = "";
  let orbScale = 0.25;
  let accentTone: "sage" | "amber" = "sage";

  if (!isRetention) {
    if (status === "idle") {
      dialPrimary = `${String(prefs.durationMinutes).padStart(2, "0")}:00`;
      dialSecondary = `${rhythm.inhaleSec}-${rhythm.holdInSec}-${rhythm.exhaleSec}${
        rhythm.holdOutSec > 0 ? `-${rhythm.holdOutSec}` : ""
      }`;
    } else if (status === "completed") {
      dialProgress = 1;
      dialPrimary = m.breathing.sessionComplete;
      dialSecondary = formatBreathingHistoryLabel(prefs.patternId, rhythm);
    } else {
      const snap = computeBreathingSnapshot(elapsedMs, rhythm);
      dialProgress = Math.min(1, elapsedMs / totalRhythmicMs);
      dialPrimary = `${snap.phaseCountdownSec}`;
      dialSecondary = `${phaseLabel(snap.phase)} · ${formatTimerDisplay(
        Math.max(0, totalRhythmicMs - elapsedMs)
      )}`;
      orbScale = snap.orbScale;
    }
  } else {
    if (status === "idle") {
      dialPrimary = `${prefs.retention.rounds}×${prefs.retention.breathsPerRound}`;
      dialSecondary = `${prefs.retention.pace.toUpperCase()} · ${prefs.retention.recoveryHoldSec}s`;
    } else if (status === "completed") {
      const stats = computeRetentionSummary(roundHoldsSec);
      dialProgress = 1;
      dialPrimary = formatRetentionHoldCompact(stats.longestSec);
      dialSecondary = `Best ${formatRetentionHoldCompact(stats.longestSec)} · Avg ${formatRetentionHoldCompact(stats.averageSec)}`;
    } else if (stage === "power") {
      const pSnap = computePowerBreathSnapshot(
        stageElapsedMs,
        prefs.retention.pace,
        prefs.retention.breathsPerRound
      );
      dialProgress = pSnap.breathNumber / pSnap.totalBreaths;
      dialPrimary = `${pSnap.breathNumber}/${pSnap.totalBreaths}`;
      dialSecondary = `R${roundIndex}/${prefs.retention.rounds} · ${phaseLabel(pSnap.subPhase)}`;
      orbScale = pSnap.orbScale;
    } else if (stage === "retention") {
      accentTone = "amber";
      dialProgress = (stageElapsedMs % 60_000) / 60_000;
      dialPrimary = formatRetentionHoldCompact(Math.floor(stageElapsedMs / 1000));
      dialSecondary = `R${roundIndex}/${prefs.retention.rounds} · ${m.breathing.stageHoldEmpty}`;
      orbScale = 0.08;
    } else if (stage === "recoveryInhale") {
      dialProgress = stageElapsedMs / (RECOVERY_INHALE_SEC * 1000);
      dialPrimary = m.breathing.phases.inhale;
      dialSecondary = `R${roundIndex}/${prefs.retention.rounds}`;
      orbScale = Math.min(1, stageElapsedMs / (RECOVERY_INHALE_SEC * 1000));
    } else if (stage === "recoveryHold") {
      accentTone = "amber";
      const rem = Math.max(
        0,
        Math.ceil(prefs.retention.recoveryHoldSec - stageElapsedMs / 1000)
      );
      dialProgress = stageElapsedMs / (prefs.retention.recoveryHoldSec * 1000);
      dialPrimary = `${rem}s`;
      dialSecondary = m.breathing.phases.holdIn;
      orbScale = 1;
    } else {
      dialProgress = stageElapsedMs / (RECOVERY_EXHALE_SEC * 1000);
      dialPrimary = m.breathing.phases.exhale;
      dialSecondary = `R${roundIndex}/${prefs.retention.rounds}`;
      orbScale = Math.max(0, 1 - stageElapsedMs / (RECOVERY_EXHALE_SEC * 1000));
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        onPress={
          isRetention && status === "running" && stage === "retention"
            ? triggerRetentionRecovery
            : undefined
        }
      >
        <PracticeDial
          progress={dialProgress}
          primaryText={dialPrimary}
          secondaryText={dialSecondary}
          orbScale={orbScale}
          accentTone={accentTone}
        />
      </Pressable>

      {/* Subtle Rhythmic | Retention toggle below dial */}
      {status === "idle" ? (
        <View
          style={[
            styles.modeToggle,
            { backgroundColor: colors.surfaceMuted },
          ]}
        >
          {(["rhythmic", "retention"] as const).map((mKey) => {
            const active = prefs.mode === mKey;
            return (
              <Pressable
                key={mKey}
                onPress={() => {
                  triggerSelectionHaptic();
                  breathingPreferencesStore.update({ mode: mKey });
                }}
                style={[
                  styles.modePill,
                  active && { backgroundColor: colors.surface },
                ]}
              >
                <Text
                  style={[
                    styles.modeText,
                    { color: active ? colors.foreground : colors.foregroundMuted },
                  ]}
                >
                  {mKey === "rhythmic"
                    ? m.breathing.modeRhythmic
                    : m.breathing.modeRetention}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Retention tap-to-inhale hint below dial */}
      {isRetention && status === "running" && stage === "retention" ? (
        <Pressable
          onPress={triggerRetentionRecovery}
          style={[styles.tapInhaleBtn, { backgroundColor: colors.accentSoft }]}
        >
          <Text style={[styles.tapInhaleText, { color: colors.accent }]}>
            {m.breathing.inhaleAndRecover}
          </Text>
        </Pressable>
      ) : null}

      {/* Idle Configuration Controls */}
      {status === "idle" ? (
        <View style={styles.configBlock}>
          {!isRetention ? (
            <>
              <View style={styles.chipRow}>
                {BREATHING_PATTERN_IDS.filter((id) => id !== "custom").map((id) => {
                  const active = prefs.patternId === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => {
                        triggerSelectionHaptic();
                        breathingPreferencesStore.update({ patternId: id });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? "#ffffff" : colors.foreground },
                        ]}
                      >
                        {id === "box"
                          ? "Box 4-4-4-4"
                          : id === "4-7-8"
                            ? "4-7-8"
                            : "Coherent 5.5"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.chipRow}>
                {BREATHING_DURATIONS.map((mins) => {
                  const active = prefs.durationMinutes === mins;
                  return (
                    <Pressable
                      key={mins}
                      onPress={() => {
                        triggerSelectionHaptic();
                        breathingPreferencesStore.update({ durationMinutes: mins });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? colors.accentSoft
                            : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.accent : colors.foreground },
                        ]}
                      >
                        {mins}m
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <View style={styles.chipRow}>
                {[1, 2, 3, 4, 5].map((r) => {
                  const active = prefs.retention.rounds === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => {
                        triggerSelectionHaptic();
                        breathingPreferencesStore.update({
                          retention: { ...prefs.retention, rounds: r },
                        });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? "#ffffff" : colors.foreground },
                        ]}
                      >
                        {r}R
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.chipRow}>
                {RETENTION_BREATH_PRESETS.map((b) => {
                  const active = prefs.retention.breathsPerRound === b;
                  return (
                    <Pressable
                      key={b}
                      onPress={() => {
                        triggerSelectionHaptic();
                        breathingPreferencesStore.update({
                          retention: { ...prefs.retention, breathsPerRound: b },
                        });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? colors.accentSoft
                            : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.accent : colors.foreground },
                        ]}
                      >
                        {b} breaths
                      </Text>
                    </Pressable>
                  );
                })}
                {RETENTION_PACE_IDS.map((pace) => {
                  const active = prefs.retention.pace === pace;
                  return (
                    <Pressable
                      key={pace}
                      onPress={() => {
                        triggerSelectionHaptic();
                        breathingPreferencesStore.update({
                          retention: { ...prefs.retention, pace },
                        });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? colors.accentSoft
                            : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.accent : colors.foreground },
                        ]}
                      >
                        {pace}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Cue Mode selector (Breath / Chime / Silent) */}
          <View style={styles.chipRow}>
            {BREATHING_CUE_MODES.map((cue: BreathingCueMode) => {
              const active = prefs.cueMode === cue;
              return (
                <Pressable
                  key={cue}
                  onPress={() => {
                    triggerSelectionHaptic();
                    breathingPreferencesStore.update({ cueMode: cue });
                  }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active
                        ? colors.accentSoft
                        : colors.surface,
                      borderColor: active ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.accent : colors.foregroundMuted },
                    ]}
                  >
                    {cue === "tone"
                      ? "Nasal Cue"
                      : cue === "chime"
                        ? "Chime"
                        : "Silent"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Primary Action Controls */}
      {status === "idle" ? (
        <Pressable
          onPress={startSession}
          style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
        >
          <Play size={18} color="#ffffff" fill="#ffffff" />
          <Text style={styles.primaryBtnText}>
            {isRetention ? m.breathing.beginRetention : m.breathing.beginBreathing}
          </Text>
        </Pressable>
      ) : status === "completed" ? (
        <View style={styles.completeActions}>
          <Pressable
            onPress={() => {
              setStatus("idle");
              onContinueToMeditation();
            }}
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.primaryBtnText}>
              {m.breathing.continueToOpenMeditation}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setStatus("idle")}
            style={[styles.secondaryBtn, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
              {m.timer.repeat}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.activeControls}>
          <Pressable
            onPress={status === "running" ? pauseSession : resumeSession}
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
          >
            {status === "running" ? (
              <Pause size={18} color="#ffffff" />
            ) : (
              <Play size={18} color="#ffffff" fill="#ffffff" />
            )}
            <Text style={styles.primaryBtnText}>
              {status === "running" ? m.timer.pause : m.timer.resume}
            </Text>
          </Pressable>

          <View style={styles.secondaryRow}>
            <Pressable
              onPress={() => setZenDim(true)}
              style={[styles.pillBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <EyeOff size={14} color={colors.foregroundMuted} />
              <Text style={[styles.pillText, { color: colors.foregroundMuted }]}>
                {m.timer.dimScreen}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleRequestFinish}
              style={[styles.pillBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Square size={14} color={colors.foregroundMuted} />
              <Text style={[styles.pillText, { color: colors.foregroundMuted }]}>
                {m.timer.finish}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      <ZenDimOverlay
        visible={zenDim}
        timeText={dialPrimary}
        subtitle={dialSecondary}
        onWake={() => setZenDim(false)}
      />

      <EarlyFinishCard
        visible={showEarlyFinish}
        elapsedLabel={formatElapsedDisplay(elapsedMs)}
        onSave={() => {
          setShowEarlyFinish(false);
          void finishAndSave(false, Math.floor(elapsedMs / 1000));
        }}
        onDiscard={() => {
          setShowEarlyFinish(false);
          stopAllAudio();
          setStatus("idle");
          setElapsedMs(0);
        }}
        onResume={() => {
          setShowEarlyFinish(false);
          resumeSession();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 16,
    width: "100%",
  },
  modeToggle: {
    flexDirection: "row",
    borderRadius: BODHI_RADIUS.full,
    padding: 3,
    gap: 2,
  },
  modePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BODHI_RADIUS.full,
  },
  modeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  tapInhaleBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: BODHI_RADIUS.full,
  },
  tapInhaleText: {
    fontSize: 14,
    fontWeight: "600",
  },
  configBlock: {
    width: "100%",
    gap: 10,
    alignItems: "center",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    maxWidth: 280,
    paddingVertical: 15,
    borderRadius: BODHI_RADIUS.full,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  completeActions: {
    width: "100%",
    alignItems: "center",
    gap: 10,
  },
  secondaryBtn: {
    width: "100%",
    maxWidth: 280,
    paddingVertical: 13,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "600" },
  activeControls: {
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  pillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: "500" },
});
