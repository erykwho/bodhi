import * as AppleAuthentication from "expo-apple-authentication";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  Bell,
  ExternalLink,
  Heart,
  LogIn,
  LogOut,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LOCALE_META, SUPPORTED_LOCALES } from "@bodhi/core/i18n";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { API_BASE_URL } from "../platform/api";
import { triggerSelectionHaptic } from "../platform/haptics";
import {
  getHealthBridgeStatus,
  setHealthSyncPreference,
} from "../platform/health";
import { syncPracticeReminders } from "../platform/reminders";
import {
  readReminderPreferences,
  type ReminderPreferences,
  type ThemePreference,
} from "../platform/storage";
import { useBodhiData } from "../state/AppDataContext";
import { useBodhiI18n } from "../state/I18nContext";
import { useBodhiTheme } from "../state/ThemeContext";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode, preference, setPreference } = useBodhiTheme();
  const { locale, setLocale, m } = useBodhiI18n();
  const { user, isOnline, signInWithGoogle, signInWithApple, signOut, deleteAccount } =
    useBodhiData();

  const [authBusy, setAuthBusy] = useState(false);
  const [reminders, setReminders] = useState<ReminderPreferences>(() =>
    readReminderPreferences()
  );
  const [healthStatus, setHealthStatus] = useState(() =>
    getHealthBridgeStatus()
  );

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      Alert.alert(
        "Sign-In",
        err instanceof Error ? err.message : "Could not complete Google sign-in."
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAppleSignIn = async () => {
    setAuthBusy(true);
    try {
      await signInWithApple();
    } catch (err) {
      Alert.alert(
        "Sign in with Apple",
        err instanceof Error ? err.message : "Could not complete Apple sign-in."
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your Bodhi account, meditation history, presets, and saved tracks from the cloud. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Permanently",
          style: "destructive",
          onPress: async () => {
            setAuthBusy(true);
            try {
              await deleteAccount();
              router.back();
            } catch {
              Alert.alert("Error", "Could not delete your account. Please try again.");
            } finally {
              setAuthBusy(false);
            }
          },
        },
      ]
    );
  };

  const updateReminders = async (next: ReminderPreferences) => {
    setReminders(next);
    const res = await syncPracticeReminders(next, locale);
    if (res.permissionDenied) {
      setReminders({ ...next, enabled: false });
      Alert.alert(
        "Notifications Disabled",
        "Enable notification permissions in system settings to receive daily practice reminders."
      );
    }
  };

  const adjustReminderTime = (deltaMinutes: number) => {
    const total = (reminders.hour * 60 + reminders.minute + deltaMinutes + 1440) % 1440;
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    triggerSelectionHaptic();
    void updateReminders({ ...reminders, hour, minute });
  };

  const toggleWeekday = (weekday: number) => {
    const exists = reminders.weekdays.includes(weekday);
    const nextDays = exists
      ? reminders.weekdays.filter((d) => d !== weekday)
      : [...reminders.weekdays, weekday].sort((a, b) => a - b);
    if (nextDays.length === 0) return;
    triggerSelectionHaptic();
    void updateReminders({ ...reminders, weekdays: nextDays });
  };

  const toggleHealthSync = async (enabled: boolean) => {
    triggerSelectionHaptic();
    const updated = await setHealthSyncPreference(enabled);
    setHealthStatus(updated);
  };

  const formattedTime = `${String(reminders.hour).padStart(2, "0")}:${String(
    reminders.minute
  ).padStart(2, "0")}`;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Settings
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
          accessibilityLabel="Close settings"
        >
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Account & Cloud Sync */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Account & Cloud Sync
          </Text>

          {user ? (
            <View style={styles.accountInfo}>
              <Text style={[styles.userName, { color: colors.foreground }]}>
                {user.name ?? user.email}
              </Text>
              <Text style={[styles.userEmail, { color: colors.foregroundMuted }]}>
                {user.email}
              </Text>

              <View style={styles.accountActions}>
                <Pressable
                  disabled={authBusy}
                  onPress={() => void signOut()}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <LogOut size={15} color={colors.foreground} />
                  <Text
                    style={[styles.actionBtnText, { color: colors.foreground }]}
                  >
                    {m.common.signOut}
                  </Text>
                </Pressable>

                <Pressable
                  disabled={authBusy || !isOnline}
                  onPress={handleDeleteAccount}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: "rgba(184, 75, 68, 0.12)" },
                  ]}
                >
                  <Trash2 size={15} color={colors.danger} />
                  <Text style={[styles.actionBtnText, { color: colors.danger }]}>
                    Delete Account
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.signInStack}>
              <Text style={[styles.helperText, { color: colors.foregroundMuted }]}>
                Timer and Guided Breathing work offline without an account. Sign
                in to sync history, presets, and guided tracks across devices.
              </Text>

              {authBusy ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <>
                  {Platform.OS === "ios" ? (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={
                        AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                      }
                      buttonStyle={
                        mode === "dark"
                          ? AppleAuthentication.AppleAuthenticationButtonStyle
                              .WHITE
                          : AppleAuthentication.AppleAuthenticationButtonStyle
                              .BLACK
                      }
                      cornerRadius={BODHI_RADIUS.full}
                      style={styles.appleButton}
                      onPress={() => void handleAppleSignIn()}
                    />
                  ) : null}

                  <Pressable
                    disabled={!isOnline}
                    onPress={() => void handleGoogleSignIn()}
                    style={[
                      styles.googleButton,
                      {
                        backgroundColor: colors.accent,
                        opacity: isOnline ? 1 : 0.5,
                      },
                    ]}
                  >
                    <LogIn size={16} color="#ffffff" />
                    <Text style={styles.googleButtonText}>
                      Continue with Google
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
        </View>

        {/* Daily Practice Reminders */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.rowBetween}>
            <View style={styles.rowIcon}>
              <Bell size={17} color={colors.accent} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Daily Practice Reminders
              </Text>
            </View>
            <Switch
              value={reminders.enabled}
              onValueChange={(enabled) =>
                void updateReminders({ ...reminders, enabled })
              }
              trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
            />
          </View>

          {reminders.enabled ? (
            <View style={styles.reminderBody}>
              <View style={styles.timeStepper}>
                <Pressable
                  onPress={() => adjustReminderTime(-15)}
                  style={[
                    styles.stepBtn,
                    { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Text style={[styles.stepBtnText, { color: colors.foreground }]}>
                    -15m
                  </Text>
                </Pressable>
                <Text style={[styles.timeDisplay, { color: colors.foreground }]}>
                  {formattedTime}
                </Text>
                <Pressable
                  onPress={() => adjustReminderTime(15)}
                  style={[
                    styles.stepBtn,
                    { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <Text style={[styles.stepBtnText, { color: colors.foreground }]}>
                    +15m
                  </Text>
                </Pressable>
              </View>

              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((label, idx) => {
                  const weekday = idx + 1;
                  const active = reminders.weekdays.includes(weekday);
                  return (
                    <Pressable
                      key={weekday}
                      onPress={() => toggleWeekday(weekday)}
                      style={[
                        styles.weekdayPill,
                        {
                          backgroundColor: active
                            ? colors.accent
                            : colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.weekdayText,
                          { color: active ? "#ffffff" : colors.foregroundMuted },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>

        {/* Mindful Minutes Health Integration */}
        {healthStatus.supported ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.rowBetween}>
              <View style={styles.rowIcon}>
                <Heart size={17} color={colors.warmAmber} />
                <Text
                  style={[styles.sectionTitle, { color: colors.foreground }]}
                >
                  {healthStatus.platformName}
                </Text>
              </View>
              <Switch
                value={healthStatus.enabled}
                onValueChange={(val) => void toggleHealthSync(val)}
                trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
              />
            </View>
            <Text style={[styles.helperText, { color: colors.foregroundMuted }]}>
              Automatically record completed meditation and breathing sessions
              as Mindful Minutes.
            </Text>
          </View>
        ) : null}

        {/* Appearance & Language */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Appearance
          </Text>
          <View style={styles.chipRow}>
            {(["system", "light", "dark"] as ThemePreference[]).map((opt) => {
              const selected = preference === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setPreference(opt);
                  }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected
                        ? colors.accent
                        : colors.surfaceMuted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selected ? "#ffffff" : colors.foreground },
                    ]}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text
            style={[
              styles.sectionTitle,
              { color: colors.foreground, marginTop: 12 },
            ]}
          >
            Language
          </Text>
          <View style={styles.chipRow}>
            {SUPPORTED_LOCALES.map((code) => {
              const selected = locale === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setLocale(code);
                  }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected
                        ? colors.accent
                        : colors.surfaceMuted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selected ? "#ffffff" : colors.foreground },
                    ]}
                  >
                    {LOCALE_META[code].nativeLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Legal & Support */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Pressable
            onPress={() => void Linking.openURL(`${API_BASE_URL}/privacy`)}
            style={styles.linkRow}
          >
            <Text style={[styles.linkText, { color: colors.foreground }]}>
              Privacy Policy
            </Text>
            <ExternalLink size={15} color={colors.foregroundMuted} />
          </Pressable>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Pressable
            onPress={() => void Linking.openURL(`${API_BASE_URL}/support`)}
            style={styles.linkRow}
          >
            <Text style={[styles.linkText, { color: colors.foreground }]}>
              Support & FAQ
            </Text>
            <ExternalLink size={15} color={colors.foregroundMuted} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  card: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
  },
  accountInfo: { gap: 4 },
  userName: { fontSize: 16, fontWeight: "600" },
  userEmail: { fontSize: 13 },
  accountActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: BODHI_RADIUS.full,
  },
  actionBtnText: { fontSize: 13, fontWeight: "600" },
  signInStack: { gap: 10 },
  appleButton: { width: "100%", height: 46 },
  googleButton: {
    height: 46,
    borderRadius: BODHI_RADIUS.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  googleButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reminderBody: { gap: 12, marginTop: 4 },
  timeStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
  },
  stepBtnText: { fontSize: 13, fontWeight: "600" },
  timeDisplay: {
    fontSize: 24,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  weekdayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  weekdayPill: {
    width: 36,
    height: 36,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayText: { fontSize: 12, fontWeight: "600" },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: BODHI_RADIUS.full,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  linkText: { fontSize: 14, fontWeight: "500" },
  divider: { height: 1 },
});
