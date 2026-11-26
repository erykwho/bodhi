import { useRouter } from "expo-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  Download,
  Headphones,
  ListMusic,
  ListPlus,
  Pencil,
  Play,
  Plus,
  Star,
  Trash2,
  WifiOff,
  X,
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
import type { ImportExternalPlaylistResponse } from "@bodhi/core/api";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  filterOfflinePlayablePlaylistTracks,
  getEligibleOfflineDownloadTracks,
  parsePlaylistUrl,
  removeTrackFromPlaylists,
  resolvePlaylistTracks,
} from "@bodhi/core/tracks/playlists";
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
import type {
  FavoriteTrackItem,
  TrackPlaylistItem,
} from "@bodhi/core/tracks/types";
import { AppHeader } from "../../components/common/AppHeader";
import { AddToPlaylistModal } from "../../components/guided/AddToPlaylistModal";
import { PlaylistImportModal } from "../../components/guided/PlaylistImportModal";
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
import {
  writeCachedPlaylists,
  writeCachedTracks,
} from "../../platform/storage";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

const FILTER_ALL = "__all__";
const FILTER_FAVORITES = "__favorites__";

type GuidedSubMode = "tracks" | "playlists";

export default function GuidedTracksScreen() {
  const router = useRouter();
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const {
    user,
    isOnline,
    tracks,
    playlists,
    setTracks,
    setPlaylists,
    refreshAll,
  } = useBodhiData();

  const offlineAudio = useSyncExternalStore(
    subscribeOfflineAudioIndex,
    getOfflineAudioIndex,
    getOfflineAudioIndex
  );

  const [subMode, setSubMode] = useState<GuidedSubMode>("tracks");
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  // Add track state
  const [showAddForm, setShowAddForm] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Playlist modals & CRUD state
  const [playlistSheetTrack, setPlaylistSheetTrack] =
    useState<FavoriteTrackItem | null>(null);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importInitialUrl, setImportInitialUrl] = useState("");
  const [importTargetPlaylistId, setImportTargetPlaylistId] = useState<
    string | null
  >(null);

  // Detail editing & library picker state
  const [editingPlaylistMeta, setEditingPlaylistMeta] = useState(false);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [editDescDraft, setEditDescDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  const [showAddLibraryPicker, setShowAddLibraryPicker] = useState(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(
    new Set()
  );
  const [addingLibraryTracks, setAddingLibraryTracks] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

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

  const displayedPlaylists = useMemo(() => {
    if (isOnline) return playlists;
    return playlists.filter(
      (pl) =>
        filterOfflinePlayablePlaylistTracks(pl, sortedTracks, offlineAudio)
          .length > 0
    );
  }, [isOnline, offlineAudio, playlists, sortedTracks]);

  const detectedPlaylistUrl = parsePlaylistUrl(urlInput);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const updatePlaylistsState = (
    updater: (prev: TrackPlaylistItem[]) => TrackPlaylistItem[]
  ) => {
    setPlaylists((prev) => {
      const next = updater(prev);
      if (user) writeCachedPlaylists(user.id, next);
      return next;
    });
  };

  const handleAddTrack = async () => {
    const parsed = parseTrackUrl(urlInput);
    if (!parsed) {
      Alert.alert(m.guided.addTrack, m.guided.errInvalidUrl);
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
        m.guided.addTrack,
        err instanceof Error ? err.message : m.guided.errSaveTrack
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
      Alert.alert(m.guided.offlineTitle, m.guided.offlineBody);
      return;
    }

    setDownloadingId(track.id);
    try {
      await downloadTrackForOffline(track);
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        m.guided.errOfflineDownload,
        err instanceof Error ? err.message : m.guided.errOfflineDownload
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteTrack = (track: FavoriteTrackItem) => {
    Alert.alert(m.common.delete, `Remove "${track.title}"?`, [
      { text: m.common.cancel, style: "cancel" },
      {
        text: m.common.delete,
        style: "destructive",
        onPress: async () => {
          removeOfflineTrack(track.id);
          setTracks((prev) => {
            const next = prev.filter((t) => t.id !== track.id);
            if (user) writeCachedTracks(user.id, next);
            return next;
          });
          updatePlaylistsState((prev) =>
            removeTrackFromPlaylists(prev, track.id)
          );
          await bodhiApi.deleteTrack(track.id).catch(() => {});
        },
      },
    ]);
  };

  const handleCreatePlaylist = async () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) {
      Alert.alert(m.guided.playlists.newPlaylist, m.guided.playlists.errEmptyName);
      return;
    }
    setCreatingPlaylist(true);
    try {
      const { playlist } = await bodhiApi.createPlaylist({
        name: trimmed,
        description: newPlaylistDesc.trim() || null,
      });
      updatePlaylistsState((prev) => [...prev, playlist]);
      setNewPlaylistName("");
      setNewPlaylistDesc("");
      setShowCreatePlaylist(false);
      setOpenPlaylistId(playlist.id);
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        m.guided.playlists.newPlaylist,
        err instanceof Error ? err.message : m.guided.playlists.errCreatePlaylist
      );
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleImportedPlaylist = (result: ImportExternalPlaylistResponse) => {
    setTracks((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const imported of result.tracks) {
        if (!byId.has(imported.id)) byId.set(imported.id, imported);
      }
      const next = sortTracksWithFavoritesFirst(Array.from(byId.values()));
      if (user) writeCachedTracks(user.id, next);
      return next;
    });
    updatePlaylistsState((prev) => {
      const exists = prev.some((p) => p.id === result.playlist.id);
      return exists
        ? prev.map((p) => (p.id === result.playlist.id ? result.playlist : p))
        : [...prev, result.playlist];
    });
    setImportModalVisible(false);
    setImportInitialUrl("");
    setImportTargetPlaylistId(null);
    setSubMode("playlists");
    setOpenPlaylistId(result.playlist.id);
    Alert.alert(
      result.playlist.name,
      m.guided.playlists.importSuccess(
        result.addedCount,
        result.skippedDuplicateCount,
        result.skippedCapCount
      )
    );
  };

  const handleSavePlaylistMeta = async (playlist: TrackPlaylistItem) => {
    const trimmed = editNameDraft.trim();
    if (!trimmed) {
      Alert.alert(
        m.guided.playlists.editPlaylist,
        m.guided.playlists.errEmptyName
      );
      return;
    }
    setSavingMeta(true);
    try {
      const { playlist: updated } = await bodhiApi.updatePlaylist(playlist.id, {
        name: trimmed,
        description: editDescDraft.trim() || null,
      });
      updatePlaylistsState((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setEditingPlaylistMeta(false);
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        m.guided.playlists.editPlaylist,
        err instanceof Error ? err.message : m.guided.playlists.errUpdatePlaylist
      );
    } finally {
      setSavingMeta(false);
    }
  };

  const handleDeletePlaylist = (playlist: TrackPlaylistItem) => {
    Alert.alert(
      m.guided.playlists.deletePlaylist,
      m.guided.playlists.deleteConfirm,
      [
        { text: m.common.cancel, style: "cancel" },
        {
          text: m.common.delete,
          style: "destructive",
          onPress: async () => {
            updatePlaylistsState((prev) =>
              prev.filter((p) => p.id !== playlist.id)
            );
            setOpenPlaylistId(null);
            await bodhiApi.deletePlaylist(playlist.id).catch(() => {});
          },
        },
      ]
    );
  };

  const handleMovePlaylistTrack = async (
    playlist: TrackPlaylistItem,
    resolvedTrackIds: string[],
    index: number,
    direction: -1 | 1
  ) => {
    if (!isOnline) return;
    const target = index + direction;
    if (target < 0 || target >= resolvedTrackIds.length) return;
    triggerSelectionHaptic();
    const nextIds = reorderItems(resolvedTrackIds, index, target);
    updatePlaylistsState((prev) =>
      prev.map((p) => (p.id === playlist.id ? { ...p, trackIds: nextIds } : p))
    );
    try {
      const { playlist: updated } = await bodhiApi.reorderPlaylistTracks(
        playlist.id,
        nextIds
      );
      updatePlaylistsState((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    } catch {
      await refreshAll();
    }
  };

  const handleRemoveFromPlaylist = async (
    playlist: TrackPlaylistItem,
    trackId: string
  ) => {
    triggerSelectionHaptic();
    updatePlaylistsState((prev) =>
      prev.map((p) =>
        p.id === playlist.id
          ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) }
          : p
      )
    );
    try {
      const { playlist: updated } = await bodhiApi.removeTrackFromPlaylist(
        playlist.id,
        trackId
      );
      updatePlaylistsState((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    } catch {
      await refreshAll();
    }
  };

  const handleAddSelectedLibraryTracks = async (
    playlist: TrackPlaylistItem
  ) => {
    const ids = Array.from(selectedLibraryIds);
    if (ids.length === 0) return;
    setAddingLibraryTracks(true);
    try {
      const { playlist: updated } = await bodhiApi.addTracksToPlaylist(
        playlist.id,
        ids
      );
      updatePlaylistsState((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setSelectedLibraryIds(new Set());
      setShowAddLibraryPicker(false);
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        m.guided.playlists.addTracks,
        err instanceof Error ? err.message : m.guided.playlists.errModifyTracks
      );
    } finally {
      setAddingLibraryTracks(false);
    }
  };

  const handleBatchDownloadOffline = async (targets: FavoriteTrackItem[]) => {
    if (!isOnline || targets.length === 0 || batchProgress) return;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setBatchProgress({ current: i + 1, total: targets.length });
      try {
        await downloadTrackForOffline(targets[i]);
      } catch {
        failed += 1;
      }
    }
    setBatchProgress(null);
    if (failed === 0) {
      triggerSuccessHaptic();
    } else {
      Alert.alert(m.guided.errOfflineDownload, m.guided.errOfflineDownload);
    }
  };

  const openPlaylist = openPlaylistId
    ? playlists.find((p) => p.id === openPlaylistId) ?? null
    : null;

  const renderSubModeSelector = () => (
    <View style={styles.subModeWrap}>
      <View
        style={[
          styles.subModePill,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
          },
        ]}
      >
        {(
          [
            { id: "tracks", label: m.guided.subModeTracks },
            { id: "playlists", label: m.guided.subModePlaylists },
          ] as const
        ).map((item) => {
          const active = subMode === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                triggerSelectionHaptic();
                setSubMode(item.id);
                setOpenPlaylistId(null);
              }}
              style={[
                styles.subModeBtn,
                active && { backgroundColor: colors.surface },
              ]}
            >
              <Text
                style={[
                  styles.subModeText,
                  {
                    color: active ? colors.foreground : colors.foregroundMuted,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderPlaylistDetail = (playlist: TrackPlaylistItem) => {
    const playlistTracks = resolvePlaylistTracks(playlist, sortedTracks);
    const offlineTracks = filterOfflinePlayablePlaylistTracks(
      playlist,
      sortedTracks,
      offlineAudio
    );
    const eligibleDownloads = getEligibleOfflineDownloadTracks(
      playlist,
      sortedTracks,
      offlineAudio
    );
    const playableQueue = isOnline ? playlistTracks : offlineTracks;
    const availableToAdd = sortedTracks.filter(
      (t) => !playlist.trackIds.includes(t.id)
    );

    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailTopBar}>
          <Pressable
            onPress={() => {
              setOpenPlaylistId(null);
              setEditingPlaylistMeta(false);
              setShowAddLibraryPicker(false);
            }}
            style={[
              styles.backPill,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ArrowLeft size={14} color={colors.foregroundMuted} />
            <Text style={[styles.backPillText, { color: colors.foreground }]}>
              {m.guided.playlists.backToPlaylists}
            </Text>
          </Pressable>

          {isOnline ? (
            <View style={styles.detailIconActions}>
              <Pressable
                onPress={() => {
                  setEditNameDraft(playlist.name);
                  setEditDescDraft(playlist.description ?? "");
                  setEditingPlaylistMeta((v) => !v);
                }}
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                {editingPlaylistMeta ? (
                  <X size={15} color={colors.foreground} />
                ) : (
                  <Pencil size={15} color={colors.foregroundMuted} />
                )}
              </Pressable>
              <Pressable
                onPress={() => handleDeletePlaylist(playlist)}
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Trash2 size={15} color={colors.foregroundMuted} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.detailCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {editingPlaylistMeta ? (
            <View style={styles.editForm}>
              <TextInput
                value={editNameDraft}
                onChangeText={setEditNameDraft}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                placeholder={m.guided.playlists.namePlaceholder}
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
                value={editDescDraft}
                onChangeText={setEditDescDraft}
                maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
                placeholder={m.guided.playlists.descriptionPlaceholder}
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
                disabled={savingMeta || !editNameDraft.trim()}
                onPress={() => void handleSavePlaylistMeta(playlist)}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: savingMeta || !editNameDraft.trim() ? 0.5 : 1,
                  },
                ]}
              >
                {savingMeta ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>{m.common.save}</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.detailTitle, { color: colors.foreground }]}>
                {playlist.name}
              </Text>
              {playlist.description ? (
                <Text
                  style={[styles.detailDesc, { color: colors.foregroundMuted }]}
                >
                  {playlist.description}
                </Text>
              ) : null}
              <Text style={[styles.detailCount, { color: colors.foregroundMuted }]}>
                {m.guided.playlists.trackCount(playlistTracks.length)}
              </Text>
            </>
          )}

          <View style={styles.detailActionRow}>
            <Pressable
              disabled={playableQueue.length === 0}
              onPress={() => {
                const first = playableQueue[0];
                if (!first) return;
                router.push({
                  pathname: "/player/[id]",
                  params: {
                    id: first.id,
                    playlistId: playlist.id,
                    index: "0",
                  },
                });
              }}
              style={[
                styles.playSeqBtn,
                {
                  backgroundColor: colors.accent,
                  opacity: playableQueue.length === 0 ? 0.45 : 1,
                },
              ]}
            >
              <Play size={14} color="#ffffff" fill="#ffffff" />
              <Text style={styles.playSeqText}>
                {m.guided.playlists.playFromStart}
              </Text>
            </Pressable>

            {isOnline ? (
              <>
                <Pressable
                  onPress={() => setShowAddLibraryPicker((v) => !v)}
                  style={[
                    styles.actionChip,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Plus size={14} color={colors.foreground} />
                  <Text
                    style={[styles.actionChipText, { color: colors.foreground }]}
                  >
                    {m.guided.playlists.addTracks}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setImportInitialUrl("");
                    setImportTargetPlaylistId(playlist.id);
                    setImportModalVisible(true);
                  }}
                  style={[
                    styles.actionChip,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Download size={14} color={colors.foregroundMuted} />
                  <Text
                    style={[
                      styles.actionChipText,
                      { color: colors.foregroundMuted },
                    ]}
                  >
                    {m.guided.playlists.importPlaylist}
                  </Text>
                </Pressable>

                {eligibleDownloads.length > 0 ? (
                  <Pressable
                    disabled={batchProgress !== null}
                    onPress={() =>
                      void handleBatchDownloadOffline(eligibleDownloads)
                    }
                    style={[
                      styles.actionChip,
                      {
                        backgroundColor: colors.accentSoft,
                        borderColor: colors.accent,
                      },
                    ]}
                  >
                    {batchProgress ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Download size={14} color={colors.accent} />
                    )}
                    <Text
                      style={[styles.actionChipText, { color: colors.accent }]}
                    >
                      {batchProgress
                        ? m.guided.playlists.downloadingBatch(
                            batchProgress.current,
                            batchProgress.total
                          )
                        : m.guided.playlists.downloadOfflineAll(
                            eligibleDownloads.length
                          )}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        </View>

        {isOnline && showAddLibraryPicker ? (
          <View
            style={[
              styles.addCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              {m.guided.playlists.addTracksTitle}
            </Text>
            {availableToAdd.length === 0 ? (
              <Text style={[styles.trackSub, { color: colors.foregroundMuted }]}>
                {sortedTracks.length === 0
                  ? m.guided.playlists.noLibraryTracksToAdd
                  : m.guided.playlists.allLibraryTracksAdded}
              </Text>
            ) : (
              <>
                {availableToAdd.map((t) => {
                  const selected = selectedLibraryIds.has(t.id);
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() =>
                        setSelectedLibraryIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                      }
                      style={[
                        styles.pickerRow,
                        {
                          backgroundColor: selected
                            ? colors.accentSoft
                            : colors.background,
                          borderColor: selected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            backgroundColor: selected
                              ? colors.accent
                              : "transparent",
                            borderColor: selected
                              ? colors.accent
                              : colors.foregroundMuted,
                          },
                        ]}
                      >
                        {selected ? <Check size={12} color="#ffffff" /> : null}
                      </View>
                      <Text
                        style={[styles.pickerTrackText, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {t.title}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  disabled={addingLibraryTracks || selectedLibraryIds.size === 0}
                  onPress={() => void handleAddSelectedLibraryTracks(playlist)}
                  style={[
                    styles.saveBtn,
                    {
                      backgroundColor: colors.accent,
                      opacity:
                        addingLibraryTracks || selectedLibraryIds.size === 0
                          ? 0.5
                          : 1,
                    },
                  ]}
                >
                  {addingLibraryTracks ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {m.guided.playlists.addSelectedTracks(
                        selectedLibraryIds.size
                      )}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        {playlistTracks.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {m.guided.playlists.emptyPlaylistTitle}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.foregroundMuted }]}>
              {m.guided.playlists.emptyPlaylistBody}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {playlistTracks.map((track, idx) => {
              const savedEntry = offlineAudio[track.id];
              const playableOffline =
                isAudioStreamProvider(track.provider) && Boolean(savedEntry);
              const disabledOffline = !isOnline && !playableOffline;
              const resolvedIds = playlistTracks.map((t) => t.id);

              return (
                <Pressable
                  key={track.id}
                  disabled={disabledOffline}
                  onPress={() => {
                    const playIdx = isOnline
                      ? idx
                      : offlineTracks.findIndex((item) => item.id === track.id);
                    if (playIdx < 0) return;
                    router.push({
                      pathname: "/player/[id]",
                      params: {
                        id: track.id,
                        playlistId: playlist.id,
                        index: String(playIdx),
                      },
                    });
                  }}
                  style={[
                    styles.trackCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      opacity: disabledOffline ? 0.5 : 1,
                    },
                  ]}
                >
                  <View style={styles.trackTop}>
                    <Text
                      style={[
                        styles.orderIndex,
                        { color: colors.foregroundMuted },
                      ]}
                    >
                      {idx + 1}
                    </Text>

                    <View style={styles.trackMeta}>
                      <Text
                        style={[styles.trackTitle, { color: colors.foreground }]}
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
                        {savedEntry
                          ? ` · Offline (${formatBytes(savedEntry.bytes)})`
                          : disabledOffline
                            ? ` · ${m.guided.playlists.offlineUnavailableTrack}`
                            : ""}
                      </Text>
                    </View>

                    {disabledOffline ? (
                      <WifiOff size={15} color={colors.warmAmber} />
                    ) : null}
                  </View>

                  {isOnline ? (
                    <View style={styles.reorderGroup}>
                      <Pressable
                        disabled={idx === 0}
                        onPress={() =>
                          void handleMovePlaylistTrack(
                            playlist,
                            resolvedIds,
                            idx,
                            -1
                          )
                        }
                        style={[
                          styles.iconMini,
                          { opacity: idx === 0 ? 0.3 : 1 },
                        ]}
                      >
                        <ArrowUp size={14} color={colors.foregroundMuted} />
                      </Pressable>
                      <Pressable
                        disabled={idx >= playlistTracks.length - 1}
                        onPress={() =>
                          void handleMovePlaylistTrack(
                            playlist,
                            resolvedIds,
                            idx,
                            1
                          )
                        }
                        style={[
                          styles.iconMini,
                          {
                            opacity:
                              idx >= playlistTracks.length - 1 ? 0.3 : 1,
                          },
                        ]}
                      >
                        <ArrowDown size={14} color={colors.foregroundMuted} />
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void handleRemoveFromPlaylist(playlist, track.id)
                        }
                        style={styles.iconMini}
                      >
                        <X size={14} color={colors.foregroundMuted} />
                      </Pressable>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    );
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
            {m.guided.signedOutBody}
          </Text>
          <Pressable
            onPress={() => router.push("/settings")}
            style={[styles.ctaBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.ctaBtnText}>{m.common.signIn}</Text>
          </Pressable>
        </View>
      ) : subMode === "playlists" && openPlaylist ? (
        renderPlaylistDetail(openPlaylist)
      ) : subMode === "playlists" ? (
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
          {renderSubModeSelector()}

          {isOnline ? (
            <View style={styles.playlistActionsRow}>
              <Pressable
                onPress={() => {
                  setImportInitialUrl("");
                  setImportTargetPlaylistId(null);
                  setImportModalVisible(true);
                }}
                style={[
                  styles.actionChip,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Download size={14} color={colors.foreground} />
                <Text
                  style={[styles.actionChipText, { color: colors.foreground }]}
                >
                  {m.guided.playlists.importPlaylist}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setShowCreatePlaylist((v) => !v)}
                style={[styles.playSeqBtn, { backgroundColor: colors.accent }]}
              >
                {showCreatePlaylist ? (
                  <X size={14} color="#ffffff" />
                ) : (
                  <Plus size={14} color="#ffffff" />
                )}
                <Text style={styles.playSeqText}>
                  {showCreatePlaylist
                    ? m.common.cancel
                    : m.guided.playlists.newPlaylist}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {showCreatePlaylist ? (
            <View
              style={[
                styles.addCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <TextInput
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                placeholder={m.guided.playlists.namePlaceholder}
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
                value={newPlaylistDesc}
                onChangeText={setNewPlaylistDesc}
                maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
                placeholder={m.guided.playlists.descriptionPlaceholder}
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
                disabled={creatingPlaylist || !newPlaylistName.trim()}
                onPress={() => void handleCreatePlaylist()}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity:
                      creatingPlaylist || !newPlaylistName.trim() ? 0.5 : 1,
                  },
                ]}
              >
                {creatingPlaylist ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {m.guided.playlists.createPlaylist}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {displayedPlaylists.length === 0 ? (
            <View style={styles.emptyList}>
              <ListMusic size={28} color={colors.foregroundMuted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {isOnline
                  ? m.guided.playlists.noPlaylistsTitle
                  : m.guided.playlists.offlineNoPlaylists}
              </Text>
              {isOnline ? (
                <Text
                  style={[styles.emptyBody, { color: colors.foregroundMuted }]}
                >
                  {m.guided.playlists.noPlaylistsBody}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.list}>
              {displayedPlaylists.map((playlist) => {
                const resolved = resolvePlaylistTracks(playlist, sortedTracks);
                const offlineCount = filterOfflinePlayablePlaylistTracks(
                  playlist,
                  sortedTracks,
                  offlineAudio
                ).length;
                const queue = isOnline
                  ? resolved
                  : filterOfflinePlayablePlaylistTracks(
                      playlist,
                      sortedTracks,
                      offlineAudio
                    );

                return (
                  <Pressable
                    key={playlist.id}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setOpenPlaylistId(playlist.id);
                    }}
                    style={[
                      styles.trackCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
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
                        <ListMusic size={17} color={colors.accent} />
                      </View>
                      <View style={styles.trackMeta}>
                        <Text
                          style={[
                            styles.trackTitle,
                            { color: colors.foreground },
                          ]}
                          numberOfLines={1}
                        >
                          {playlist.name}
                        </Text>
                        {playlist.description ? (
                          <Text
                            style={[
                              styles.trackSub,
                              { color: colors.foregroundMuted },
                            ]}
                            numberOfLines={1}
                          >
                            {playlist.description}
                          </Text>
                        ) : null}
                        <Text
                          style={[
                            styles.trackSub,
                            { color: colors.foregroundMuted },
                          ]}
                        >
                          {m.guided.playlists.trackCount(resolved.length)}
                          {offlineCount > 0
                            ? ` · ${m.guided.playlists.offlineTrackCount(offlineCount, resolved.length)}`
                            : ""}
                        </Text>
                      </View>

                      {queue.length > 0 ? (
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: "/player/[id]",
                              params: {
                                id: queue[0].id,
                                playlistId: playlist.id,
                                index: "0",
                              },
                            })
                          }
                          style={[
                            styles.playBadge,
                            { backgroundColor: colors.accent },
                          ]}
                        >
                          <Play size={14} color="#ffffff" fill="#ffffff" />
                        </Pressable>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
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
          {renderSubModeSelector()}

          {/* Single-row Filter Bar + Add Trigger */}
          <View style={styles.topRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {[
                { id: FILTER_ALL, label: m.common.all },
                { id: FILTER_FAVORITES, label: m.guided.favoritesFilter },
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
                accessibilityLabel={m.guided.addTrack}
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
                placeholder={m.guided.urlPlaceholder}
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

              {detectedPlaylistUrl ? (
                <View
                  style={[
                    styles.playlistHintRow,
                    {
                      backgroundColor: colors.accentSoft,
                      borderColor: colors.accent,
                    },
                  ]}
                >
                  <Text
                    style={[styles.playlistHintText, { color: colors.foreground }]}
                  >
                    {detectedPlaylistUrl.isDirectPlaylistUrl
                      ? m.guided.playlistUrlDetectedHint
                      : m.guided.videoInPlaylistHint}
                  </Text>
                  <Pressable
                    onPress={() => {
                      setShowAddForm(false);
                      setUrlInput("");
                      setTitleInput("");
                      setImportInitialUrl(detectedPlaylistUrl.canonicalUrl);
                      setImportTargetPlaylistId(null);
                      setImportModalVisible(true);
                    }}
                    style={[
                      styles.importHintBtn,
                      { backgroundColor: colors.accent },
                    ]}
                  >
                    <Text style={styles.importHintBtnText}>
                      {m.guided.importDetectedPlaylist}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <TextInput
                value={titleInput}
                onChangeText={setTitleInput}
                placeholder={m.guided.titlePlaceholder}
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
                  <Text style={styles.saveBtnText}>{m.guided.saveTrack}</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {filteredTracks.length === 0 ? (
            <View style={styles.emptyList}>
              <Text
                style={[styles.emptyBody, { color: colors.foregroundMuted }]}
              >
                {m.guided.noTracksBody}
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
                        <Play
                          size={15}
                          color={colors.accent}
                          fill={colors.accent}
                        />
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

                      {isOnline ? (
                        <Pressable
                          onPress={() => {
                            triggerSelectionHaptic();
                            setPlaylistSheetTrack(track);
                          }}
                          hitSlop={8}
                        >
                          <ListPlus size={18} color={colors.foregroundMuted} />
                        </Pressable>
                      ) : null}

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
                            <Download
                              size={14}
                              color={colors.foregroundMuted}
                            />
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
                            {savedEntry
                              ? m.guided.player.savedOffline
                              : m.guided.player.saveOffline}
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
                            <ArrowUp
                              size={14}
                              color={colors.foregroundMuted}
                            />
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

      <AddToPlaylistModal
        track={playlistSheetTrack}
        playlists={playlists}
        onClose={() => setPlaylistSheetTrack(null)}
        onPlaylistUpdated={(updated) =>
          updatePlaylistsState((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p))
          )
        }
        onPlaylistCreated={(created) =>
          updatePlaylistsState((prev) => [...prev, created])
        }
      />

      <PlaylistImportModal
        visible={importModalVisible}
        initialUrl={importInitialUrl}
        playlists={playlists}
        defaultTargetPlaylistId={importTargetPlaylistId}
        onClose={() => {
          setImportModalVisible(false);
          setImportInitialUrl("");
          setImportTargetPlaylistId(null);
        }}
        onImported={handleImportedPlaylist}
      />
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
  subModeWrap: {
    alignItems: "center",
  },
  subModePill: {
    flexDirection: "row",
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  subModeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: BODHI_RADIUS.full,
  },
  subModeText: { fontSize: 12, fontWeight: "600" },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600", textAlign: "center" },
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
  playlistActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  playSeqBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
  },
  playSeqText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  actionChipText: { fontSize: 12, fontWeight: "600" },
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
  playlistHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  playlistHintText: { fontSize: 12, flex: 1 },
  importHintBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BODHI_RADIUS.full,
  },
  importHintBtnText: { color: "#ffffff", fontSize: 11, fontWeight: "600" },
  saveBtn: {
    borderRadius: BODHI_RADIUS.full,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  emptyList: { paddingVertical: 40, alignItems: "center", gap: 8 },
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
  detailTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  backPillText: { fontSize: 12, fontWeight: "600" },
  detailIconActions: { flexDirection: "row", gap: 8 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCard: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  detailTitle: { fontSize: 18, fontWeight: "700" },
  detailDesc: { fontSize: 13, lineHeight: 18 },
  detailCount: { fontSize: 12 },
  detailActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  editForm: { gap: 8 },
  pickerTitle: { fontSize: 13, fontWeight: "600" },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerTrackText: { fontSize: 13, flex: 1 },
  orderIndex: { fontSize: 12, fontWeight: "600", width: 20, textAlign: "center" },
});
