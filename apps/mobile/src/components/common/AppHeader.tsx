import { useRouter } from "expo-router";
import { Moon, RefreshCw, Settings, Sun, WifiOff } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { triggerSelectionHaptic } from "../../platform/haptics";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";
import { BodhiLogo } from "./BodhiLogo";

export function AppHeader() {
  const router = useRouter();
  const { colors, mode, toggleTheme } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const { user, isOnline, isSyncing, pendingCount } = useBodhiData();

  const showNetworkPill = !isOnline || isSyncing || pendingCount > 0;

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <BodhiLogo size={28} />
          <Text style={[styles.title, { color: colors.foreground }]}>Bodhi</Text>
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={() => {
              triggerSelectionHaptic();
              toggleTheme();
            }}
            style={[
              styles.iconButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            accessibilityLabel={
              mode === "dark" ? m.common.switchToLight : m.common.switchToDark
            }
          >
            {mode === "dark" ? (
              <Sun size={18} color={colors.foregroundMuted} />
            ) : (
              <Moon size={18} color={colors.foregroundMuted} />
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              triggerSelectionHaptic();
              router.push("/settings");
            }}
            style={[
              styles.accountButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            accessibilityLabel="Settings"
          >
            {user ? (
              <View
                style={[styles.avatar, { backgroundColor: colors.accentSoft }]}
              >
                <Text style={[styles.avatarText, { color: colors.accent }]}>
                  {(user.name ?? user.email).charAt(0).toUpperCase()}
                </Text>
              </View>
            ) : null}
            <Settings size={17} color={colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>

      {showNetworkPill ? (
        <View style={styles.pillRow}>
          <View
            style={[
              styles.pill,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {!isOnline ? (
              <>
                <WifiOff size={12} color={colors.warmAmber} />
                <Text
                  style={[styles.pillText, { color: colors.foregroundMuted }]}
                >
                  {pendingCount > 0
                    ? m.network.offlinePending(pendingCount)
                    : m.network.offlineTimerReady}
                </Text>
              </>
            ) : (
              <>
                <RefreshCw size={12} color={colors.accent} />
                <Text
                  style={[styles.pillText, { color: colors.foregroundMuted }]}
                >
                  {m.network.syncing(pendingCount)}
                </Text>
              </>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  accountButton: {
    height: 38,
    paddingHorizontal: 10,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 11,
    fontWeight: "700",
  },
  pillRow: {
    marginTop: 8,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "500",
  },
});
