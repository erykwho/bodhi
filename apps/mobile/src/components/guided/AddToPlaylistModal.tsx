import { Check, ListMusic, Plus, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { MAX_PLAYLIST_NAME_LENGTH } from "@bodhi/core/tracks/playlists";
import type {
  FavoriteTrackItem,
  TrackPlaylistItem,
} from "@bodhi/core/tracks/types";
import { bodhiApi } from "../../platform/api";
import {
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

interface AddToPlaylistModalProps {
  track: FavoriteTrackItem | null;
  playlists: TrackPlaylistItem[];
  onClose: () => void;
  onPlaylistUpdated: (playlist: TrackPlaylistItem) => void;
  onPlaylistCreated: (playlist: TrackPlaylistItem) => void;
}

export function AddToPlaylistModal({
  track,
  playlists,
  onClose,
  onPlaylistUpdated,
  onPlaylistCreated,
}: AddToPlaylistModalProps) {
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  if (!track) return null;

  const handleToggle = async (playlist: TrackPlaylistItem) => {
    setBusyId(playlist.id);
    triggerSelectionHaptic();
    const exists = playlist.trackIds.includes(track.id);
    try {
      const { playlist: updated } = exists
        ? await bodhiApi.removeTrackFromPlaylist(playlist.id, track.id)
        : await bodhiApi.addTracksToPlaylist(playlist.id, [track.id]);
      onPlaylistUpdated(updated);
    } catch (err) {
      Alert.alert(
        m.guided.playlists.addToPlaylistTitle,
        err instanceof Error ? err.message : m.guided.playlists.errModifyTracks
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const { playlist } = await bodhiApi.createPlaylist({
        name: trimmed,
        trackIds: [track.id],
      });
      onPlaylistCreated(playlist);
      setNewName("");
      triggerSuccessHaptic();
    } catch (err) {
      Alert.alert(
        m.guided.playlists.newPlaylist,
        err instanceof Error ? err.message : m.guided.playlists.errCreatePlaylist
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      visible={Boolean(track)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.headerMeta}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {m.guided.playlists.addToPlaylistTitle}
              </Text>
              <Text
                style={[styles.subtitle, { color: colors.foregroundMuted }]}
                numberOfLines={1}
              >
                {track.title}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
            >
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView style={styles.listScroll} contentContainerStyle={styles.list}>
            {playlists.map((playlist) => {
              const isIn = playlist.trackIds.includes(track.id);
              const isBusy = busyId === playlist.id;
              return (
                <Pressable
                  key={playlist.id}
                  disabled={isBusy}
                  onPress={() => void handleToggle(playlist)}
                  style={[
                    styles.row,
                    {
                      backgroundColor: isIn
                        ? colors.accentSoft
                        : colors.background,
                      borderColor: isIn ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <ListMusic
                    size={16}
                    color={isIn ? colors.accent : colors.foregroundMuted}
                  />
                  <View style={styles.rowMeta}>
                    <Text
                      style={[styles.rowTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {playlist.name}
                    </Text>
                    <Text
                      style={[styles.rowSub, { color: colors.foregroundMuted }]}
                    >
                      {m.guided.playlists.trackCount(playlist.trackIds.length)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: isIn ? colors.accent : "transparent",
                        borderColor: isIn
                          ? colors.accent
                          : colors.foregroundMuted,
                      },
                    ]}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : isIn ? (
                      <Check size={12} color="#ffffff" />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.quickCreate, { borderTopColor: colors.border }]}>
            <Text style={[styles.quickLabel, { color: colors.foregroundMuted }]}>
              {m.guided.playlists.quickCreatePlaylist}
            </Text>
            <View style={styles.quickRow}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
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
              <Pressable
                disabled={creating || !newName.trim()}
                onPress={() => void handleQuickCreate()}
                style={[
                  styles.createBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: creating || !newName.trim() ? 0.5 : 1,
                  },
                ]}
              >
                {creating ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Plus size={16} color="#ffffff" />
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: BODHI_RADIUS.lg,
    borderTopRightRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 20,
    gap: 14,
    maxHeight: "75%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerMeta: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "600" },
  subtitle: { fontSize: 12 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  listScroll: { maxHeight: 240 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowMeta: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: "500" },
  rowSub: { fontSize: 11 },
  badge: {
    width: 22,
    height: 22,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  quickCreate: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  quickLabel: { fontSize: 12, fontWeight: "500" },
  quickRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  createBtn: {
    width: 40,
    height: 40,
    borderRadius: BODHI_RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
