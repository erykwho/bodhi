import { useRouter } from "expo-router";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Headphones,
  Play,
  Plus,
  Star,
  Trash2,
} from "lucide-react-native";
import React, { useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import {
  isAudioStreamProvider,
  parseTrackUrl,
  TRACK_PROVIDER_LABELS,
} from "@bodhi/core/tracks/providers";
import {
  applyFavoriteToggle,
  getFavoriteGroupRange,
  reorderItems,
  sortTracksWithFavoritesFirst,
} from "@bodhi/core/tracks/reorder";
import type { FavoriteTrackItem } from "@bodhi/core/tracks/types";
import { AppHeader } from "../../components/common/AppHeader";
import { bodhiApi } from "../../platform/api";
import {
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import {
  downloadTrackForOffline,
  formatBytes,
  getOfflineAudioIndex,
  removeOfflineTrack,
  subscribeOfflineAudioIndex,
} from "../../platform/offline-audio";
import { writeCachedTracks } from "../../platform/storage";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

const FILTER_ALL = "__all__";
const FILTER_FAVORITES = "__favorites__";

export default function GuidedTracksScreen() {
  const router = useRouter();
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const { user, isOnline, tracks, setTracks, refreshAll } = useBodhiData();

  const offlineAudio = useSyncExternalStore(
    subscribeOfflineAudioIndex,
    getOfflineAudioIndex,
    getOfflineAudioIndex
  );

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [showAddForm, setShowAddForm] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const sortedTracks = useMemo(
    () => sortTracksWithFavoritesFirst(tracks),
    [tracks]
  );

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const t of sortedTracks) {
      for (const tag of t.tags) tagSet.add(tag);
    }
    return Array.from(tagSet);
  }, [sortedTracks]);

  const filteredTracks = useMemo(() => {
    if (filter === FILTER_ALL) return sortedTracks;
    if (filter === FILTER_FAVORITES) {
      return sortedTracks.filter((t) => t.isFavorite);
    }
    return sortedTracks.filter((t) => t.tags.includes(filter));
  }, [filter, sortedTracks]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const handleAddTrack = async () => {
    const parsed = parseTrackUrl(urlInput);
    if (!parsed) {
      Alert.alert(
        "Unsupported URL",
        "Paste a YouTube, SoundCloud, Google Drive audio link, or direct audio URL (.mp3/.m4a/.ogg/.wav)."
      );
      return;
    }

    setAdding(true);
    try {
      const { track } = await bodhiApi.createTrack({
        url: urlInput.trim(),
        title: titleInput.trim() || undefined,
      });
      setTracks((prev) => {
        const next = sortTracksWithFavoritesFirst([
          track,
          ...prev.filter((t) => t.id !== track.id),
        ]);
        if (user) writeCachedTracks(user.id, next);
        return next;
      });
      setUrlInput("");
      setTitleInput("");
      setShowAddForm(false);
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        "Could not save track",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setAdding(false);
    }
  };

  const handleToggleFavorite = async (track: FavoriteTrackItem) => {
    if (!isOnline) return;
    triggerSelectionHaptic();
    const nextFav = !track.isFavorite;
    const optimistic = applyFavoriteToggle(sortedTracks, track.id, nextFav);
    setTracks(optimistic);
    if (user) writeCachedTracks(user.id, optimistic);

    try {
      await bodhiApi.updateTrack(track.id, { isFavorite: nextFav });
    } catch {
      await refreshAll();
    }
  };

  const handleMoveWithinGroup = async (
    track: FavoriteTrackItem,
    direction: -1 | 1
  ) => {
    if (!isOnline) return;
    const idx = sortedTracks.findIndex((t) => t.id === track.id);
    if (idx < 0) return;
    const { start, end } = getFavoriteGroupRange(sortedTracks, idx);
    const target = idx + direction;
    if (target < start || target > end) return;

    triggerSelectionHaptic();
    const reordered = reorderItems(sortedTracks, idx, target);
    setTracks(reordered);
    if (user) writeCachedTracks(user.id, reordered);

    try {
      await bodhiApi.reorderTracks(reordered.map((t) => t.id));
    } catch {
      await refreshAll();
    }
  };

  const handleToggleOffline = async (track: FavoriteTrackItem) => {
    const existing = offlineAudio[track.id];
    if (existing) {
      removeOfflineTrack(track.id);
      triggerSelectionHaptic();
      return;
    }

    if (!isOnline) {
      Alert.alert("Offline", "Reconnect to download this track for offline listening.");
      return;
    }

    setDownloadingId(track.id);
    try {
      await downloadTrackForOffline(track);
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        "Download failed",
        err instanceof Error ? err.message : "Could not save audio offline."
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteTrack = (track: FavoriteTrackItem) => {
    Alert.alert("Remove Track", `Remove "${track.title}" from your library?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          removeOfflineTrack(track.id);
          setTracks((prev) => {
            const next = prev.filter((t) => t.id !== track.id);
            if (user) writeCachedTracks(user.id, next);
            return next;
          });
          await bodhiApi.deleteTrack(track.id).catch(() => {});
        },
      },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <AppHeader />

      {!user ? (
        <View style={styles.emptyState}>
          <Headphones size={34} color={colors.accent} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {m.nav.guided}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.foregroundMuted }]}>
            Sign in from Settings to save YouTube, SoundCloud, Google Drive, and
            direct audio meditations with permanent offline downloads.
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
          {/* Single-row Filter Bar + Add Trigger */}
          <View style={styles.topRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {[
                { id: FILTER_ALL, label: "All" },
                { id: FILTER_FAVORITES, label: "Favorites" },
                ...allTags.map((tag) => ({ id: tag, label: tag })),
              ].map((item) => {
                const active = filter === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setFilter(item.id);
                    }}
                    style={[
                      styles.filterChip,
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
                        styles.filterText,
                        { color: active ? "#ffffff" : colors.foregroundMuted },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {isOnline ? (
              <Pressable
                onPress={() => setShowAddForm((v) => !v)}
                style={[styles.addBtn, { backgroundColor: colors.accent }]}
                accessibilityLabel="Add guided track"
              >
                <Plus size={18} color="#ffffff" />
              </Pressable>
            ) : null}
          </View>

          {showAddForm ? (
            <View
              style={[
                styles.addCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <TextInput
                value={urlInput}
                onChangeText={setUrlInput}
                placeholder="Paste YouTube, SoundCloud, Drive, or .mp3 URL"
                placeholderTextColor={colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
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
                value={titleInput}
                onChangeText={setTitleInput}
                placeholder="Optional custom title"
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
              <Pressable
                disabled={adding || !urlInput.trim()}
                onPress={() => void handleAddTrack()}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: adding || !urlInput.trim() ? 0.5 : 1,
                  },
                ]}
              >
                {adding ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Add Guided Track</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {filteredTracks.length === 0 ? (
            <View style={styles.emptyList}>
              <Text
                style={[styles.emptyBody, { color: colors.foregroundMuted }]}
              >
                No guided tracks yet. Tap + to add your favorite meditations.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filteredTracks.map((track) => {
                const savedEntry = offlineAudio[track.id];
                const canOffline = isAudioStreamProvider(track.provider);
                const fullIndex = sortedTracks.findIndex(
                  (t) => t.id === track.id
                );
                const groupRange = getFavoriteGroupRange(
                  sortedTracks,
                  fullIndex
                );

                return (
                  <Pressable
                    key={track.id}
                    onPress={() =>
                      router.push({
                        pathname: "/player/[id]",
                        params: { id: track.id },
                      })
                    }
                    style={[
                      styles.trackCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: track.isFavorite
                          ? colors.warmAmber
                          : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.trackTop}>
                      <View
                        style={[
                          styles.playBadge,
                          { backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <Play size={15} color={colors.accent} fill={colors.accent} />
                      </View>

                      <View style={styles.trackMeta}>
                        <Text
                          style={[
                            styles.trackTitle,
                            { color: colors.foreground },
                          ]}
                          numberOfLines={2}
                        >
                          {track.title}
                        </Text>
                        <Text
                          style={[
                            styles.trackSub,
                            { color: colors.foregroundMuted },
                          ]}
                          numberOfLines={1}
                        >
                          {TRACK_PROVIDER_LABELS[track.provider]}
                          {track.author ? ` · ${track.author}` : ""}
                          {savedEntry
                            ? ` · Offline (${formatBytes(savedEntry.bytes)})`
                            : ""}
                        </Text>
                      </View>

                      <Pressable
                        onPress={() => void handleToggleFavorite(track)}
                        hitSlop={10}
                      >
                        <Star
                          size={18}
                          color={
                            track.isFavorite
                              ? colors.warmAmber
                              : colors.foregroundMuted
                          }
                          fill={
                            track.isFavorite ? colors.warmAmber : "transparent"
                          }
                        />
                      </Pressable>
                    </View>

                    {/* Action Footer */}
                    <View style={styles.trackActions}>
                      {canOffline ? (
                        <Pressable
                          disabled={downloadingId === track.id}
                          onPress={() => void handleToggleOffline(track)}
                          style={[
                            styles.miniBtn,
                            { backgroundColor: colors.surfaceMuted },
                          ]}
                        >
                          {downloadingId === track.id ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.accent}
                            />
                          ) : savedEntry ? (
                            <CheckCircle2 size={14} color={colors.accent} />
                          ) : (
                            <Download size={14} color={colors.foregroundMuted} />
                          )}
                          <Text
                            style={[
                              styles.miniBtnText,
                              {
                                color: savedEntry
                                  ? colors.accent
                                  : colors.foregroundMuted,
                              },
                            ]}
                          >
                            {savedEntry ? "Saved offline" : "Save offline"}
                          </Text>
                        </Pressable>
                      ) : null}

                      {isOnline && filter === FILTER_ALL ? (
                        <View style={styles.reorderGroup}>
                          <Pressable
                            disabled={fullIndex <= groupRange.start}
                            onPress={() =>
                              void handleMoveWithinGroup(track, -1)
                            }
                            style={[
                              styles.iconMini,
                              {
                                opacity:
                                  fullIndex <= groupRange.start ? 0.3 : 1,
                              },
                            ]}
                          >
                            <ArrowUp size={14} color={colors.foregroundMuted} />
                          </Pressable>
                          <Pressable
                            disabled={fullIndex >= groupRange.end}
                            onPress={() => void handleMoveWithinGroup(track, 1)}
                            style={[
                              styles.iconMini,
                              { opacity: fullIndex >= groupRange.end ? 0.3 : 1 },
                            ]}
                          >
                            <ArrowDown
                              size={14}
                              color={colors.foregroundMuted}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() => handleDeleteTrack(track)}
                            style={styles.iconMini}
                          >
                            <Trash2 size={14} color={colors.foregroundMuted} />
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
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
  emptyBody: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  ctaBtn: {
    marginTop: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: BODHI_RADIUS.full,
  },
  ctaBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filterRow: { gap: 8, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  filterText: { fontSize: 12, fontWeight: "600" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  addCard: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  saveBtn: {
    borderRadius: BODHI_RADIUS.full,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  emptyList: { paddingVertical: 40, alignItems: "center" },
  list: { gap: 10 },
  trackCard: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  trackTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playBadge: {
    width: 38,
    height: 38,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  trackMeta: { flex: 1, gap: 2 },
  trackTitle: { fontSize: 15, fontWeight: "600" },
  trackSub: { fontSize: 12 },
  trackActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  miniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BODHI_RADIUS.full,
  },
  miniBtnText: { fontSize: 11, fontWeight: "600" },
  reorderGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginLeft: "auto",
  },
  iconMini: { padding: 4 },
});
