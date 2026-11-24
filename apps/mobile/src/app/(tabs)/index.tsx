import { useKeepAwake } from "expo-keep-awake";
import {
  BookmarkPlus,
  EyeOff,
  Pause,
  Play,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getAmbientSoundOption,
  getBellSoundOption,
} from "@bodhi/core/audio/sounds";
import { MIN_SAVEABLE_EARLY_STOP_SECONDS } from "@bodhi/core/history/stats";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import {
  computeIntervalBellIndex,
  computeOpenEndedIntervalBellIndex,
  formatElapsedDisplay,
  formatTimerDisplay,
} from "@bodhi/core/timer/engine";
import {
  doesPresetMatchPreferences,
  formatPresetSummary,
  sanitizePresetName,
} from "@bodhi/core/timer/presets";
import {
  DURATION_PRESETS_MINUTES,
  type TimerPhase,
  type TimerPreferences,
} from "@bodhi/core/timer/types";
import { BreathingView } from "../../components/breathing/BreathingView";
import { AppHeader } from "../../components/common/AppHeader";
import { EarlyFinishCard } from "../../components/common/EarlyFinishCard";
import { ZenDimOverlay } from "../../components/common/ZenDimOverlay";
import { PracticeDial } from "../../components/timer/PracticeDial";
import { SoundPickerModal } from "../../components/timer/SoundPickerModal";
import { nativeAudioEngine } from "../../platform/audio/native-engine";
import {
  triggerBellHaptic,
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import { timerPreferencesStore } from "../../platform/storage";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

type SubMode = "timer" | "open" | "breathe";

export default function TimerTabScreen() {
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const { presets, saveSession, createPreset, deletePreset } = useBodhiData();

  const prefs = useSyncExternalStore(
    timerPreferencesStore.subscribe,
    timerPreferencesStore.getSnapshot,
    timerPreferencesStore.getDefaultSnapshot
  );

  const [subMode, setSubMode] = useState<SubMode>(() =>
    prefs.openEnded ? "open" : "timer"
  );
  const [phase, setPhase] = useState<TimerPhase>("idle");
  const [remainingMs, setRemainingMs] = useState(
    prefs.durationMinutes * 60 * 1000
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [warmupLeftSec, setWarmupLeftSec] = useState(0);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  const [zenDim, setZenDim] = useState(false);
  const [showEarlyFinish, setShowEarlyFinish] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState("");

  const startEpochRef = useRef<number>(0);
  const warmupEndEpochRef = useRef<number>(0);
  const sessionStartedIsoRef = useRef<string>("");
  const lastIntervalIndexRef = useRef<number>(0);

  const isRunning = phase === "warmup" || phase === "running";
  useKeepAwake(isRunning ? "bodhi-timer" : undefined);

  const totalPlannedMs = prefs.durationMinutes * 60 * 1000;

  const updatePrefs = useCallback((patch: Partial<TimerPreferences>) => {
    timerPreferencesStore.update(patch);
  }, []);

  const stopPracticeAudio = useCallback(() => {
    nativeAudioEngine.cancelBellStrikes();
    nativeAudioEngine.stopAmbient(0.7);
    nativeAudioEngine.stopBackgroundKeepAlive();
    nativeAudioEngine.clearLockScreen();
  }, []);

  const completeSession = useCallback(
    async (completed: boolean, actualSec: number) => {
      stopPracticeAudio();
      setZenDim(false);
      setPhase("completed");
      triggerSuccessHaptic();
      nativeAudioEngine.playBellStrikes(
        prefs.endBell,
        prefs.endBellStrikes,
        prefs.bellVolume
      );

      await saveSession({
        mode: "TIMER",
        plannedDurationSec: prefs.openEnded ? null : prefs.durationMinutes * 60,
        actualDurationSec: Math.max(1, actualSec),
        completed,
        startedAt: sessionStartedIsoRef.current || undefined,
      });
    },
    [
      prefs.bellVolume,
      prefs.durationMinutes,
      prefs.endBell,
      prefs.endBellStrikes,
      prefs.openEnded,
      saveSession,
      stopPracticeAudio,
    ]
  );

  const startActiveRunning = useCallback(
    (now: number) => {
      startEpochRef.current = now;
      sessionStartedIsoRef.current = new Date(now).toISOString();
      lastIntervalIndexRef.current = 0;
      setPhase("running");
      setElapsedMs(0);
      setRemainingMs(totalPlannedMs);

      triggerBellHaptic();
      nativeAudioEngine.playBellSound(prefs.startBell, prefs.bellVolume);
      if (prefs.ambientSound !== "silence") {
        nativeAudioEngine.startAmbient(prefs.ambientSound, prefs.ambientVolume);
      } else {
        nativeAudioEngine.startBackgroundKeepAlive();
      }
      nativeAudioEngine.updateLockScreen({
        title: prefs.openEnded
          ? "Open Meditation"
          : `Meditation · ${prefs.durationMinutes}m`,
        durationSec: prefs.openEnded ? undefined : prefs.durationMinutes * 60,
        elapsedSec: 0,
        state: "playing",
      });
    },
    [
      prefs.ambientSound,
      prefs.ambientVolume,
      prefs.bellVolume,
      prefs.durationMinutes,
      prefs.openEnded,
      prefs.startBell,
      totalPlannedMs,
    ]
  );

  const handleBegin = () => {
    nativeAudioEngine.unlock({
      bells: [prefs.startBell, prefs.endBell, prefs.intervalBell],
      ambientSound: prefs.ambientSound,
    });

    const now = Date.now();
    if (prefs.warmupSeconds > 0) {
      warmupEndEpochRef.current = now + prefs.warmupSeconds * 1000;
      setWarmupLeftSec(prefs.warmupSeconds);
      setPhase("warmup");
      nativeAudioEngine.startBackgroundKeepAlive();
    } else {
      startActiveRunning(now);
    }
  };

  const handlePause = () => {
    setPhase("paused");
    nativeAudioEngine.stopAmbient(0.3);
    nativeAudioEngine.updateLockScreen({
      title: prefs.openEnded
        ? "Open Meditation"
        : `Meditation · ${prefs.durationMinutes}m`,
      elapsedSec: Math.floor(elapsedMs / 1000),
      state: "paused",
    });
  };

  const handleResume = () => {
    startEpochRef.current = Date.now() - elapsedMs;
    setPhase("running");
    if (prefs.ambientSound !== "silence") {
      nativeAudioEngine.startAmbient(prefs.ambientSound, prefs.ambientVolume);
    } else {
      nativeAudioEngine.startBackgroundKeepAlive();
    }
    nativeAudioEngine.updateLockScreen({
      title: prefs.openEnded
        ? "Open Meditation"
        : `Meditation · ${prefs.durationMinutes}m`,
      durationSec: prefs.openEnded ? undefined : prefs.durationMinutes * 60,
      elapsedSec: Math.floor(elapsedMs / 1000),
      state: "playing",
    });
  };

  const handleFinishTap = () => {
    const practicedSec = Math.floor(elapsedMs / 1000);
    if (prefs.openEnded && practicedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
      void completeSession(true, practicedSec);
      return;
    }
    if (practicedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
      handlePause();
      setShowEarlyFinish(true);
    } else {
      stopPracticeAudio();
      setPhase("idle");
      setElapsedMs(0);
      setRemainingMs(totalPlannedMs);
    }
  };

  // Drift-free timestamp loop (works seamlessly across screen lock & background audio)
  useEffect(() => {
    if (phase !== "warmup" && phase !== "running") return;

    const timer = setInterval(() => {
      const now = Date.now();

      if (phase === "warmup") {
        const leftMs = warmupEndEpochRef.current - now;
        if (leftMs <= 0) {
          startActiveRunning(now);
        } else {
          setWarmupLeftSec(Math.ceil(leftMs / 1000));
        }
        return;
      }

      const elapsed = Math.max(0, now - startEpochRef.current);
      setElapsedMs(elapsed);

      if (prefs.openEnded) {
        if (prefs.intervalEnabled) {
          const idx = computeOpenEndedIntervalBellIndex(
            elapsed,
            prefs.intervalMinutes * 60 * 1000
          );
          if (idx > lastIntervalIndexRef.current) {
            lastIntervalIndexRef.current = idx;
            nativeAudioEngine.playBellSound(
              prefs.intervalBell,
              prefs.bellVolume
            );
          }
        }
      } else {
        const rem = Math.max(0, totalPlannedMs - elapsed);
        setRemainingMs(rem);

        if (prefs.intervalEnabled && rem > 0) {
          const idx = computeIntervalBellIndex(
            elapsed,
            totalPlannedMs,
            prefs.intervalMinutes * 60 * 1000
          );
          if (idx > lastIntervalIndexRef.current) {
            lastIntervalIndexRef.current = idx;
            nativeAudioEngine.playBellSound(
              prefs.intervalBell,
              prefs.bellVolume
            );
          }
        }

        if (rem <= 0) {
          void completeSession(true, prefs.durationMinutes * 60);
        }
      }
    }, 150);

    return () => clearInterval(timer);
  }, [
    completeSession,
    phase,
    prefs.bellVolume,
    prefs.durationMinutes,
    prefs.intervalBell,
    prefs.intervalEnabled,
    prefs.intervalMinutes,
    prefs.openEnded,
    startActiveRunning,
    totalPlannedMs,
  ]);

  useEffect(() => {
    return () => stopPracticeAudio();
  }, [stopPracticeAudio]);

  const handleSavePreset = async () => {
    const clean = sanitizePresetName(presetNameInput);
    if (!clean) return;
    await createPreset(clean, prefs);
    setPresetNameInput("");
    setSavingPreset(false);
    triggerSuccessHaptic();
  };

  const switchSubMode = (next: SubMode) => {
    if (phase !== "idle" && phase !== "completed") return;
    triggerSelectionHaptic();
    setSubMode(next);
    if (next === "open") {
      updatePrefs({ openEnded: true });
    } else if (next === "timer") {
      updatePrefs({ openEnded: false });
    }
    setPhase("idle");
  };

  const dialPrimary =
    phase === "warmup"
      ? `${warmupLeftSec}s`
      : phase === "completed"
        ? m.timer.sessionComplete
        : prefs.openEnded
          ? formatElapsedDisplay(elapsedMs)
          : formatTimerDisplay(phase === "idle" ? totalPlannedMs : remainingMs);

  const dialProgress =
    phase === "idle"
      ? 0
      : phase === "warmup"
        ? 1 - warmupLeftSec / Math.max(1, prefs.warmupSeconds)
        : phase === "completed"
          ? 1
          : prefs.openEnded
            ? (elapsedMs % 60_000) / 60_000
            : Math.min(1, elapsedMs / totalPlannedMs);

  const dialSecondary =
    phase === "warmup"
      ? m.timer.phasePrepare
      : prefs.ambientSound !== "silence"
        ? getAmbientSoundOption(prefs.ambientSound).name
        : getBellSoundOption(prefs.startBell).name;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <AppHeader />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Subtle Timer · Open · Breathe selector */}
        {phase === "idle" || phase === "completed" ? (
          <View
            style={[
              styles.subModeBar,
              { backgroundColor: colors.surfaceMuted },
            ]}
          >
            {(
              [
                { id: "timer", label: m.timer.subModeTimer },
                { id: "open", label: m.timer.subModeOpen },
                { id: "breathe", label: m.timer.subModeBreathe },
              ] as const
            ).map((item) => {
              const active = subMode === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => switchSubMode(item.id)}
                  style={[
                    styles.subModePill,
                    active && { backgroundColor: colors.surface },
                  ]}
                >
                  <Text
                    style={[
                      styles.subModeText,
                      {
                        color: active
                          ? colors.foreground
                          : colors.foregroundMuted,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {subMode === "breathe" ? (
          <BreathingView
            onContinueToMeditation={() => switchSubMode("timer")}
          />
        ) : (
          <View style={styles.timerContainer}>
            <PracticeDial
              progress={dialProgress}
              primaryText={dialPrimary}
              secondaryText={dialSecondary}
              accentTone={phase === "warmup" ? "amber" : "sage"}
            />

            {/* Duration Presets (Timer mode, idle) */}
            {phase === "idle" && !prefs.openEnded ? (
              <View style={styles.presetRow}>
                {DURATION_PRESETS_MINUTES.map((mins) => {
                  const active = prefs.durationMinutes === mins;
                  return (
                    <Pressable
                      key={mins}
                      onPress={() => {
                        triggerSelectionHaptic();
                        updatePrefs({ durationMinutes: mins });
                        setRemainingMs(mins * 60 * 1000);
                      }}
                      style={[
                        styles.durationPill,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.durationText,
                          { color: active ? "#ffffff" : colors.foreground },
                        ]}
                      >
                        {mins}m
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* Primary Controls */}
            {phase === "idle" ? (
              <View style={styles.idleActions}>
                <Pressable
                  onPress={handleBegin}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Play size={18} color="#ffffff" fill="#ffffff" />
                  <Text style={styles.primaryBtnText}>
                    {m.timer.beginSession}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    triggerSelectionHaptic();
                    setSoundSheetOpen(true);
                  }}
                  style={[
                    styles.soundBtn,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <SlidersHorizontal size={15} color={colors.accent} />
                  <Text
                    style={[styles.soundBtnText, { color: colors.foreground }]}
                  >
                    {getBellSoundOption(prefs.startBell).name} ·{" "}
                    {getAmbientSoundOption(prefs.ambientSound).name}
                    {prefs.endBellStrikes === 3 ? " · 3×" : ""}
                  </Text>
                </Pressable>

                {/* Practice Presets Strip */}
                <View style={styles.presetsSection}>
                  <View style={styles.presetsHeader}>
                    <Text
                      style={[
                        styles.presetsLabel,
                        { color: colors.foregroundMuted },
                      ]}
                    >
                      Presets
                    </Text>
                    <Pressable
                      onPress={() => setSavingPreset((s) => !s)}
                      style={styles.savePresetTrigger}
                    >
                      <BookmarkPlus size={14} color={colors.accent} />
                      <Text
                        style={[
                          styles.savePresetText,
                          { color: colors.accent },
                        ]}
                      >
                        Save
                      </Text>
                    </Pressable>
                  </View>

                  {savingPreset ? (
                    <View style={styles.savePresetRow}>
                      <TextInput
                        value={presetNameInput}
                        onChangeText={setPresetNameInput}
                        placeholder="Preset name (e.g. Morning Zen)"
                        placeholderTextColor={colors.foregroundMuted}
                        style={[
                          styles.presetInput,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                            color: colors.foreground,
                          },
                        ]}
                      />
                      <Pressable
                        onPress={() => void handleSavePreset()}
                        style={[
                          styles.saveConfirmBtn,
                          { backgroundColor: colors.accent },
                        ]}
                      >
                        <Text style={styles.saveConfirmText}>Save</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {presets.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.presetScroll}
                    >
                      {presets.map((preset) => {
                        const active = doesPresetMatchPreferences(preset, prefs);
                        return (
                          <Pressable
                            key={preset.id}
                            onPress={() => {
                              triggerSelectionHaptic();
                              updatePrefs(preset.preferences);
                              setSubMode(
                                preset.preferences.openEnded ? "open" : "timer"
                              );
                            }}
                            onLongPress={() => {
                              Alert.alert(
                                "Delete Preset",
                                `Remove "${preset.name}"?`,
                                [
                                  { text: "Cancel", style: "cancel" },
                                  {
                                    text: "Delete",
                                    style: "destructive",
                                    onPress: () => void deletePreset(preset.id),
                                  },
                                ]
                              );
                            }}
                            style={[
                              styles.presetChip,
                              {
                                backgroundColor: active
                                  ? colors.accentSoft
                                  : colors.surface,
                                borderColor: active
                                  ? colors.accent
                                  : colors.border,
                              },
                            ]}
                          >
                            <View>
                              <Text
                                style={[
                                  styles.presetName,
                                  { color: colors.foreground },
                                ]}
                              >
                                {preset.name}
                              </Text>
                              <Text
                                style={[
                                  styles.presetSub,
                                  { color: colors.foregroundMuted },
                                ]}
                              >
                                {formatPresetSummary(preset.preferences)}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() => void deletePreset(preset.id)}
                              hitSlop={8}
                            >
                              <Trash2 size={13} color={colors.foregroundMuted} />
                            </Pressable>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}
                </View>
              </View>
            ) : phase === "completed" ? (
              <Pressable
                onPress={() => {
                  setPhase("idle");
                  setElapsedMs(0);
                  setRemainingMs(totalPlannedMs);
                }}
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.primaryBtnText}>{m.timer.repeat}</Text>
              </Pressable>
            ) : (
              <View style={styles.activeActions}>
                {phase !== "warmup" ? (
                  <Pressable
                    onPress={phase === "running" ? handlePause : handleResume}
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: colors.accent },
                    ]}
                  >
                    {phase === "running" ? (
                      <Pause size={18} color="#ffffff" />
                    ) : (
                      <Play size={18} color="#ffffff" fill="#ffffff" />
                    )}
                    <Text style={styles.primaryBtnText}>
                      {phase === "running" ? m.timer.pause : m.timer.resume}
                    </Text>
                  </Pressable>
                ) : null}

                <View style={styles.secondaryRow}>
                  <Pressable
                    onPress={() => setZenDim(true)}
                    style={[
                      styles.pillBtn,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <EyeOff size={14} color={colors.foregroundMuted} />
                    <Text
                      style={[
                        styles.pillText,
                        { color: colors.foregroundMuted },
                      ]}
                    >
                      {m.timer.dimScreen}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={handleFinishTap}
                    style={[
                      styles.pillBtn,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Square size={14} color={colors.foregroundMuted} />
                    <Text
                      style={[
                        styles.pillText,
                        { color: colors.foregroundMuted },
                      ]}
                    >
                      {m.timer.finish}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <SoundPickerModal
        visible={soundSheetOpen}
        preferences={prefs}
        onUpdate={updatePrefs}
        onClose={() => setSoundSheetOpen(false)}
      />

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
          void completeSession(false, Math.floor(elapsedMs / 1000));
        }}
        onDiscard={() => {
          setShowEarlyFinish(false);
          stopPracticeAudio();
          setPhase("idle");
          setElapsedMs(0);
          setRemainingMs(totalPlannedMs);
        }}
        onResume={() => {
          setShowEarlyFinish(false);
          handleResume();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 20,
  },
  subModeBar: {
    flexDirection: "row",
    borderRadius: BODHI_RADIUS.full,
    padding: 3,
    gap: 2,
  },
  subModePill: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: BODHI_RADIUS.full,
  },
  subModeText: { fontSize: 13, fontWeight: "600" },
  timerContainer: {
    width: "100%",
    alignItems: "center",
    gap: 18,
  },
  presetRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  durationPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  durationText: { fontSize: 13, fontWeight: "600" },
  idleActions: {
    width: "100%",
    alignItems: "center",
    gap: 12,
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
  primaryBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  soundBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  soundBtnText: { fontSize: 13, fontWeight: "500" },
  presetsSection: {
    width: "100%",
    marginTop: 4,
    gap: 8,
  },
  presetsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  presetsLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  savePresetTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  savePresetText: { fontSize: 12, fontWeight: "600" },
  savePresetRow: {
    flexDirection: "row",
    gap: 8,
  },
  presetInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 13,
  },
  saveConfirmBtn: {
    paddingHorizontal: 16,
    borderRadius: BODHI_RADIUS.full,
    justifyContent: "center",
  },
  saveConfirmText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  presetScroll: { gap: 8, paddingVertical: 2 },
  presetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetName: { fontSize: 13, fontWeight: "600" },
  presetSub: { fontSize: 11 },
  activeActions: {
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  secondaryRow: { flexDirection: "row", gap: 10 },
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
