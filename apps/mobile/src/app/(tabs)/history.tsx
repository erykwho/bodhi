import { File, Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Flame,
  Plus,
  Trash2,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { sessionsToCsv, sessionsToJson } from "@bodhi/core/history/export";
import {
  buildMonthlyCalendar,
  computeHistoryStats,
  filterSessionsByPeriod,
  formatTotalTime,
  toLocalDateKey,
  type HistoryPeriod,
} from "@bodhi/core/history/stats";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { AppHeader } from "../../components/common/AppHeader";
import {
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

export default function MeditationHistoryScreen() {
  const router = useRouter();
  const { colors } = useBodhiTheme();
  const { intlTag, m } = useBodhiI18n();
  const { user, sessions, refreshAll, saveSession, deleteSession } =
    useBodhiData();

  const [period, setPeriod] = useState<HistoryPeriod>("30d");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Manual log modal
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [manualMinutes, setManualMinutes] = useState("15");
  const [manualNote, setManualNote] = useState("");

  const periodSessions = useMemo(
    () => filterSessionsByPeriod(sessions, period),
    [period, sessions]
  );

  const visibleSessions = useMemo(
    () =>
      selectedDateKey
        ? sessions.filter(
            (s) => toLocalDateKey(new Date(s.endedAt)) === selectedDateKey
          )
        : periodSessions,
    [periodSessions, selectedDateKey, sessions]
  );

  const stats = useMemo(
    () => computeHistoryStats(periodSessions),
    [periodSessions]
  );

  const allTimeStats = useMemo(() => computeHistoryStats(sessions), [sessions]);

  const calendar = useMemo(
    () =>
      buildMonthlyCalendar(
        sessions,
        calendarMonth.year,
        calendarMonth.month
      ),
    [calendarMonth.month, calendarMonth.year, sessions]
  );

  const monthLabel = useMemo(() => {
    const d = new Date(calendarMonth.year, calendarMonth.month, 1);
    return new Intl.DateTimeFormat(intlTag, {
      month: "long",
      year: "numeric",
    }).format(d);
  }, [calendarMonth.month, calendarMonth.year, intlTag]);

  const shiftMonth = (delta: number) => {
    triggerSelectionHaptic();
    setCalendarMonth((prev) => {
      const nextDate = new Date(prev.year, prev.month + delta, 1);
      return { year: nextDate.getFullYear(), month: nextDate.getMonth() };
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const handleExport = async (format: "csv" | "json") => {
    try {
      const content =
        format === "csv"
          ? sessionsToCsv(sessions)
          : sessionsToJson(sessions);
      const filename = `bodhi-history-${new Date().toISOString().slice(0, 10)}.${format}`;
      const file = new File(Paths.cache, filename);
      file.write(content);

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Export", "Native sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: format === "csv" ? "text/csv" : "application/json",
        dialogTitle: "Export Bodhi History",
      });
    } catch {
      Alert.alert("Export failed", "Could not generate export file.");
    }
  };

  const handleManualLog = async () => {
    const mins = Number.parseInt(manualMinutes, 10);
    if (!Number.isFinite(mins) || mins < 1 || mins > 360) {
      Alert.alert("Invalid duration", "Enter a duration between 1 and 360 minutes.");
      return;
    }
    await saveSession({
      mode: "TIMER",
      plannedDurationSec: mins * 60,
      actualDurationSec: mins * 60,
      completed: true,
      note: manualNote.trim() || null,
    });
    setManualMinutes("15");
    setManualNote("");
    setLogModalOpen(false);
    triggerSuccessHaptic();
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <AppHeader />

      {!user ? (
        <View style={styles.emptyState}>
          <CalendarDays size={34} color={colors.accent} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {m.nav.history}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.foregroundMuted }]}>
            Sign in from Settings to track your streaks, monthly practice
            heatmap, reflection notes, and CSV/JSON exports.
          </Text>
          <Pressable
            onPress={() => router.push("/settings")}
            style={[styles.ctaBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.ctaBtnText}>{m.common.signIn}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Period Filter + Manual Log + Export */}
          <View style={styles.controlsRow}>
            <View
              style={[
                styles.periodBar,
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              {(["7d", "30d", "all"] as HistoryPeriod[]).map((p) => {
                const active = period === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setSelectedDateKey(null);
                      setPeriod(p);
                    }}
                    style={[
                      styles.periodPill,
                      active && { backgroundColor: colors.surface },
                    ]}
                  >
                    <Text
                      style={[
                        styles.periodText,
                        {
                          color: active
                            ? colors.foreground
                            : colors.foregroundMuted,
                        },
                      ]}
                    >
                      {p === "all" ? "All" : p}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rightControls}>
              <Pressable
                onPress={() => setLogModalOpen(true)}
                style={[
                  styles.smallAction,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Plus size={14} color="#ffffff" />
                <Text style={styles.smallActionTextWhite}>Log</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Alert.alert("Export History", "Choose format", [
                    { text: "Cancel", style: "cancel" },
                    { text: "CSV", onPress: () => void handleExport("csv") },
                    { text: "JSON", onPress: () => void handleExport("json") },
                  ]);
                }}
                style={[
                  styles.iconAction,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Download size={15} color={colors.foregroundMuted} />
              </Pressable>
            </View>
          </View>

          {/* Summary Stat Cards */}
          <View style={styles.statsRow}>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Clock size={16} color={colors.accent} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatTotalTime(stats.totalSeconds)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.foregroundMuted }]}>
                Total Time
              </Text>
            </View>

            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Flame size={16} color={colors.warmAmber} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {allTimeStats.currentStreakDays}d
              </Text>
              <Text style={[styles.statLabel, { color: colors.foregroundMuted }]}>
                Best {allTimeStats.longestStreakDays}d
              </Text>
            </View>

            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <CalendarDays size={16} color={colors.accent} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {stats.totalSessions}
              </Text>
              <Text style={[styles.statLabel, { color: colors.foregroundMuted }]}>
                Sessions
              </Text>
            </View>
          </View>

          {/* Monthly Practice Calendar / Heatmap */}
          <View
            style={[
              styles.calendarCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.calendarHeader}>
              <Pressable onPress={() => shiftMonth(-1)} hitSlop={10}>
                <ChevronLeft size={18} color={colors.foregroundMuted} />
              </Pressable>
              <Text
                style={[styles.calendarTitle, { color: colors.foreground }]}
              >
                {monthLabel}
              </Text>
              <Pressable onPress={() => shiftMonth(1)} hitSlop={10}>
                <ChevronRight size={18} color={colors.foregroundMuted} />
              </Pressable>
            </View>

            <View style={styles.calendarGrid}>
              {WEEKDAY_HEADERS.map((w, idx) => (
                <Text
                  key={`${w}-${idx}`}
                  style={[styles.weekdayCell, { color: colors.foregroundMuted }]}
                >
                  {w}
                </Text>
              ))}
              {Array.from({ length: calendar.leadingEmptyCells }).map((_, i) => (
                <View key={`empty-${i}`} style={styles.dayCell} />
              ))}
              {calendar.days.map((day) => {
                const selected = selectedDateKey === day.dateKey;
                const intensityBg =
                  day.intensity === 0
                    ? "transparent"
                    : day.intensity === 1
                      ? colors.accentSoft
                      : day.intensity === 2
                        ? "rgba(74, 107, 93, 0.45)"
                        : colors.accent;

                return (
                  <Pressable
                    key={day.dateKey}
                    onPress={() => {
                      if (day.sessionCount === 0) return;
                      triggerSelectionHaptic();
                      setSelectedDateKey((prev) =>
                        prev === day.dateKey ? null : day.dateKey
                      );
                    }}
                    style={[
                      styles.dayCell,
                      {
                        backgroundColor: intensityBg,
                        borderColor: selected
                          ? colors.warmAmber
                          : day.isToday
                            ? colors.accent
                            : "transparent",
                        borderWidth: selected || day.isToday ? 1.5 : 0,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color:
                            day.intensity === 3
                              ? "#ffffff"
                              : day.isFuture
                                ? colors.foregroundMuted
                                : colors.foreground,
                          opacity: day.isFuture ? 0.4 : 1,
                        },
                      ]}
                    >
                      {day.dayOfMonth}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Session List */}
          <View style={styles.sessionList}>
            {selectedDateKey ? (
              <Pressable
                onPress={() => setSelectedDateKey(null)}
                style={styles.clearFilter}
              >
                <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>
                  Filtered by {selectedDateKey} · Clear filter
                </Text>
              </Pressable>
            ) : null}

            {visibleSessions.map((session) => {
              const title =
                session.mode === "TRACK"
                  ? session.trackTitle ?? "Guided Meditation"
                  : session.mode === "BREATHING"
                    ? session.breathingPattern ?? "Guided Breathing"
                    : session.plannedDurationSec === null
                      ? "Open Meditation"
                      : "Silent Timer";

              return (
                <View
                  key={session.id}
                  style={[
                    styles.sessionCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.sessionTop}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.sessionTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {title}
                      </Text>
                      <Text
                        style={[
                          styles.sessionMeta,
                          { color: colors.foregroundMuted },
                        ]}
                      >
                        {formatTotalTime(session.actualDurationSec)} ·{" "}
                        {new Date(session.endedAt).toLocaleDateString(intlTag)}
                        {session.pendingSync ? " · Pending sync" : ""}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          "Delete Session",
                          "Remove this session from your history?",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => void deleteSession(session.id),
                            },
                          ]
                        );
                      }}
                      hitSlop={10}
                    >
                      <Trash2 size={15} color={colors.foregroundMuted} />
                    </Pressable>
                  </View>

                  {session.note ? (
                    <Text
                      style={[
                        styles.sessionNote,
                        { color: colors.foregroundMuted },
                      ]}
                    >
                      {session.note}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Manual Log Modal */}
      <Modal
        visible={logModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLogModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Log Meditation Session
            </Text>

            <TextInput
              value={manualMinutes}
              onChangeText={setManualMinutes}
              keyboardType="number-pad"
              placeholder="Minutes (e.g. 15)"
              placeholderTextColor={colors.foregroundMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
            />

            <TextInput
              value={manualNote}
              onChangeText={setManualNote}
              placeholder="Optional reflection note"
              placeholderTextColor={colors.foregroundMuted}
              multiline
              style={[
                styles.input,
                {
                  minHeight: 72,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
            />

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setLogModalOpen(false)}
                style={[
                  styles.modalBtn,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handleManualLog()}
                style={[styles.modalBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={{ color: "#ffffff", fontWeight: "600" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 14,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 19, fontWeight: "600" },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  ctaBtn: {
    marginTop: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: BODHI_RADIUS.full,
  },
  ctaBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  periodBar: {
    flexDirection: "row",
    borderRadius: BODHI_RADIUS.full,
    padding: 3,
    gap: 2,
  },
  periodPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BODHI_RADIUS.full,
  },
  periodText: { fontSize: 12, fontWeight: "600" },
  rightControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  smallAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
  },
  smallActionTextWhite: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 11, fontWeight: "500" },
  calendarCard: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  calendarTitle: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  weekdayCell: {
    width: "14.28%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    paddingBottom: 6,
  },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  dayNum: { fontSize: 12, fontWeight: "600" },
  sessionList: { gap: 10 },
  clearFilter: { alignSelf: "flex-start" },
  sessionCard: {
    borderRadius: BODHI_RADIUS.md,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  sessionTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  sessionTitle: { fontSize: 14, fontWeight: "600" },
  sessionMeta: { fontSize: 12, marginTop: 2 },
  sessionNote: { fontSize: 13, lineHeight: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
  },
});
