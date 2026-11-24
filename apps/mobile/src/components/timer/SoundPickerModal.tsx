import { Bell, Volume2, X } from "lucide-react-native";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AMBIENT_SOUNDS,
  BELL_SOUNDS,
  type AmbientSoundId,
  type BellSoundId,
} from "@bodhi/core/audio/sounds";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import {
  BELL_STRIKE_OPTIONS,
  INTERVAL_PRESETS_MINUTES,
  WARMUP_OPTIONS_SECONDS,
  type TimerPreferences,
} from "@bodhi/core/timer/types";
import { nativeAudioEngine } from "../../platform/audio/native-engine";
import { triggerSelectionHaptic } from "../../platform/haptics";
import { useBodhiTheme } from "../../state/ThemeContext";

interface SoundPickerModalProps {
  visible: boolean;
  preferences: TimerPreferences;
  onUpdate: (patch: Partial<TimerPreferences>) => void;
  onClose: () => void;
}

const VOLUME_STEPS = [0.25, 0.5, 0.75, 0.85, 1.0] as const;

export function SoundPickerModal({
  visible,
  preferences,
  onUpdate,
  onClose,
}: SoundPickerModalProps) {
  const { colors } = useBodhiTheme();

  const handleClose = () => {
    nativeAudioEngine.stopPreview();
    onClose();
  };

  const selectBell = (field: "startBell" | "endBell" | "intervalBell", id: BellSoundId) => {
    triggerSelectionHaptic();
    onUpdate({ [field]: id });
    if (id !== "none") {
      nativeAudioEngine.playBellSound(id, preferences.bellVolume);
    }
  };

  const selectAmbient = (id: AmbientSoundId) => {
    triggerSelectionHaptic();
    onUpdate({ ambientSound: id });
    if (id === "silence") {
      nativeAudioEngine.stopPreview();
    } else {
      nativeAudioEngine.startPreview(id, preferences.ambientVolume, undefined, 5000);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.background }]}
        edges={["top", "bottom"]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <Volume2 size={18} color={colors.accent} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Bells & Soundscape
            </Text>
          </View>
          <Pressable
            onPress={handleClose}
            style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
          >
            <X size={18} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* Warm-up */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Warm-up Delay
            </Text>
            <View style={styles.chipRow}>
              {WARMUP_OPTIONS_SECONDS.map((sec) => {
                const active = preferences.warmupSeconds === sec;
                return (
                  <Pressable
                    key={sec}
                    onPress={() => {
                      triggerSelectionHaptic();
                      onUpdate({ warmupSeconds: sec });
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.accent
                          : colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? "#ffffff" : colors.foreground },
                      ]}
                    >
                      {sec === 0 ? "Off" : `${sec}s`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Opening & Closing Bells */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.headerLeft}>
                <Bell size={16} color={colors.accent} />
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Opening Bell
                </Text>
              </View>
            </View>
            <View style={styles.chipRow}>
              {BELL_SOUNDS.map((bell) => {
                const active = preferences.startBell === bell.id;
                return (
                  <Pressable
                    key={bell.id}
                    onPress={() => selectBell("startBell", bell.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.accent
                          : colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? "#ffffff" : colors.foreground },
                      ]}
                    >
                      {bell.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text
              style={[
                styles.sectionTitle,
                { color: colors.foreground, marginTop: 10 },
              ]}
            >
              Closing Bell
            </Text>
            <View style={styles.chipRow}>
              {BELL_SOUNDS.map((bell) => {
                const active = preferences.endBell === bell.id;
                return (
                  <Pressable
                    key={bell.id}
                    onPress={() => selectBell("endBell", bell.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.accent
                          : colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? "#ffffff" : colors.foreground },
                      ]}
                    >
                      {bell.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rowBetween}>
              <Text style={[styles.label, { color: colors.foregroundMuted }]}>
                Closing Strikes
              </Text>
              <View style={styles.chipRow}>
                {BELL_STRIKE_OPTIONS.map((count) => {
                  const active = preferences.endBellStrikes === count;
                  return (
                    <Pressable
                      key={count}
                      onPress={() => {
                        triggerSelectionHaptic();
                        onUpdate({ endBellStrikes: count });
                      }}
                      style={[
                        styles.smallChip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? "#ffffff" : colors.foreground },
                        ]}
                      >
                        {count}×
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.rowBetween}>
              <Text style={[styles.label, { color: colors.foregroundMuted }]}>
                Bell Volume ({Math.round(preferences.bellVolume * 100)}%)
              </Text>
              <View style={styles.chipRow}>
                {VOLUME_STEPS.map((vol) => {
                  const active = Math.abs(preferences.bellVolume - vol) < 0.04;
                  return (
                    <Pressable
                      key={vol}
                      onPress={() => {
                        triggerSelectionHaptic();
                        onUpdate({ bellVolume: vol });
                        if (preferences.startBell !== "none") {
                          nativeAudioEngine.playBellSound(
                            preferences.startBell,
                            vol
                          );
                        }
                      }}
                      style={[
                        styles.smallChip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? "#ffffff" : colors.foreground },
                        ]}
                      >
                        {Math.round(vol * 100)}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Interval Chime */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Interval Bell
              </Text>
              <Switch
                value={preferences.intervalEnabled}
                onValueChange={(enabled) => {
                  triggerSelectionHaptic();
                  onUpdate({ intervalEnabled: enabled });
                }}
                trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
              />
            </View>
            {preferences.intervalEnabled ? (
              <View style={styles.chipRow}>
                {INTERVAL_PRESETS_MINUTES.map((mins) => {
                  const active = preferences.intervalMinutes === mins;
                  return (
                    <Pressable
                      key={mins}
                      onPress={() => {
                        triggerSelectionHaptic();
                        onUpdate({ intervalMinutes: mins });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? "#ffffff" : colors.foreground },
                        ]}
                      >
                        Every {mins}m
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {/* Ambient Soundscapes */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Ambient Soundscape (Offline)
            </Text>
            <View style={styles.chipRow}>
              {AMBIENT_SOUNDS.map((sound) => {
                const active = preferences.ambientSound === sound.id;
                return (
                  <Pressable
                    key={sound.id}
                    onPress={() => selectAmbient(sound.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active
                          ? colors.accent
                          : colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? "#ffffff" : colors.foreground },
                      ]}
                    >
                      {sound.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {preferences.ambientSound !== "silence" ? (
              <View style={[styles.rowBetween, { marginTop: 6 }]}>
                <Text style={[styles.label, { color: colors.foregroundMuted }]}>
                  Ambient Volume ({Math.round(preferences.ambientVolume * 100)}%)
                </Text>
                <View style={styles.chipRow}>
                  {[0.2, 0.35, 0.55, 0.75, 1.0].map((vol) => {
                    const active =
                      Math.abs(preferences.ambientVolume - vol) < 0.04;
                    return (
                      <Pressable
                        key={vol}
                        onPress={() => {
                          triggerSelectionHaptic();
                          onUpdate({ ambientVolume: vol });
                          nativeAudioEngine.setAmbientVolume(vol);
                        }}
                        style={[
                          styles.smallChip,
                          {
                            backgroundColor: active
                              ? colors.accent
                              : colors.surfaceMuted,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: active ? "#ffffff" : colors.foreground },
                          ]}
                        >
                          {Math.round(vol * 100)}%
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontWeight: "600" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  card: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "500" },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
  },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BODHI_RADIUS.full,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
});
