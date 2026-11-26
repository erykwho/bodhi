import { Check, Download, ListMusic, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
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
import type { ImportExternalPlaylistResponse } from "@bodhi/core/api";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  parsePlaylistUrl,
} from "@bodhi/core/tracks/playlists";
import type {
  ResolvedExternalPlaylist,
  TrackPlaylistItem,
} from "@bodhi/core/tracks/types";
import { bodhiApi } from "../../platform/api";
import {
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

interface PlaylistImportModalProps {
  visible: boolean;
  initialUrl?: string;
  playlists: TrackPlaylistItem[];
  defaultTargetPlaylistId?: string | null;
  onClose: () => void;
  onImported: (result: ImportExternalPlaylistResponse) => void;
}

export function PlaylistImportModal({
  visible,
  initialUrl = "",
  playlists,
  defaultTargetPlaylistId = null,
  onClose,
  onImported,
}: PlaylistImportModalProps) {
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();

  const [urlInput, setUrlInput] = useState(initialUrl);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedExternalPlaylist | null>(
    null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"new" | "existing">(
    defaultTargetPlaylistId && playlists.length > 0 ? "existing" : "new"
  );
  const [targetPlaylistId, setTargetPlaylistId] = useState<string>(
    defaultTargetPlaylistId ?? playlists[0]?.id ?? ""
  );
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [importing, setImporting] = useState(false);

  const runResolve = async (rawUrl: string) => {
    const parsed = parsePlaylistUrl(rawUrl);
    if (!parsed) {
      Alert.alert(
        m.guided.playlists.importTitle,
        m.guided.playlists.errInvalidPlaylistUrl
      );
      return;
    }

    setResolving(true);
    try {
      const { playlist } = await bodhiApi.resolveExternalPlaylist(
        parsed.canonicalUrl
      );
      setResolved(playlist);
      setSelectedIds(new Set(playlist.tracks.map((t) => t.externalId)));
      setNewName(playlist.title.slice(0, MAX_PLAYLIST_NAME_LENGTH));
      triggerSelectionHaptic();
    } catch (err) {
      setResolved(null);
      Alert.alert(
        m.guided.playlists.importTitle,
        err instanceof Error ? err.message : m.guided.playlists.errResolvePlaylist
      );
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setUrlInput(initialUrl);
    setResolved(null);
    setSelectedIds(new Set());
    setMode(defaultTargetPlaylistId && playlists.length > 0 ? "existing" : "new");
    setTargetPlaylistId(defaultTargetPlaylistId ?? playlists[0]?.id ?? "");
    setNewDescription("");
    if (initialUrl && parsePlaylistUrl(initialUrl)) {
      void runResolve(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialUrl, defaultTargetPlaylistId]);

  const toggleTrack = (externalId: string) => {
    triggerSelectionHaptic();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const handleConfirmImport = async () => {
    if (!resolved) return;
    const chosenTracks = resolved.tracks.filter((t) =>
      selectedIds.has(t.externalId)
    );
    if (chosenTracks.length === 0) {
      Alert.alert(
        m.guided.playlists.importTitle,
        m.guided.playlists.errSelectTracks
      );
      return;
    }

    if (mode === "new" && !newName.trim()) {
      Alert.alert(
        m.guided.playlists.importTitle,
        m.guided.playlists.errEmptyName
      );
      return;
    }

    const effectiveTargetId =
      mode === "existing" ? targetPlaylistId || playlists[0]?.id || "" : undefined;
    if (mode === "existing" && !effectiveTargetId) {
      Alert.alert(
        m.guided.playlists.importTitle,
        m.guided.playlists.errSelectPlaylist
      );
      return;
    }

    setImporting(true);
    try {
      const result = await bodhiApi.importExternalPlaylist({
        mode,
        ...(mode === "new"
          ? {
              name: newName.trim(),
              description: newDescription.trim() || null,
            }
          : { playlistId: effectiveTargetId }),
        tracks: chosenTracks,
      });
      triggerSuccessHaptic();
      onImported(result);
    } catch (err) {
      Alert.alert(
        m.guided.playlists.importTitle,
        err instanceof Error ? err.message : m.guided.playlists.errImportPlaylist
      );
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = resolved
    ? resolved.tracks.filter((t) => selectedIds.has(t.externalId)).length
    : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <ListMusic size={18} color={colors.accent} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              {m.guided.playlists.importTitle}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: colors.surfaceMuted }]}
          >
            <X size={18} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.label, { color: colors.foreground }]}>
            {m.guided.playlists.importUrlLabel}
          </Text>

          <View style={styles.urlRow}>
            <TextInput
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder={m.guided.playlists.importUrlPlaceholder}
              placeholderTextColor={colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                styles.urlInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
            />
            <Pressable
              disabled={resolving || !urlInput.trim()}
              onPress={() => void runResolve(urlInput)}
              style={[
                styles.resolveBtn,
                {
                  backgroundColor: colors.accent,
                  opacity: resolving || !urlInput.trim() ? 0.5 : 1,
                },
              ]}
            >
              {resolving ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Download size={16} color="#ffffff" />
              )}
            </Pressable>
          </View>

          {resolved ? (
            <View style={styles.previewSection}>
              {resolved.truncated ? (
                <View
                  style={[
                    styles.noticeBox,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.warmAmber,
                    },
                  ]}
                >
                  <Text style={[styles.noticeText, { color: colors.foreground }]}>
                    {m.guided.playlists.truncatedNotice(
                      resolved.limit,
                      resolved.totalCount
                    )}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.label, { color: colors.foreground }]}>
                {m.guided.playlists.importDestinationLabel}
              </Text>

              <View
                style={[
                  styles.segmentRow,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Pressable
                  onPress={() => {
                    triggerSelectionHaptic();
                    setMode("new");
                  }}
                  style={[
                    styles.segmentBtn,
                    mode === "new" && { backgroundColor: colors.surface },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color:
                          mode === "new"
                            ? colors.foreground
                            : colors.foregroundMuted,
                      },
                    ]}
                  >
                    {m.guided.playlists.importModeNew}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={playlists.length === 0}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setMode("existing");
                  }}
                  style={[
                    styles.segmentBtn,
                    mode === "existing" && { backgroundColor: colors.surface },
                    playlists.length === 0 && { opacity: 0.4 },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color:
                          mode === "existing"
                            ? colors.foreground
                            : colors.foregroundMuted,
                      },
                    ]}
                  >
                    {m.guided.playlists.importModeExisting}
                  </Text>
                </Pressable>
              </View>

              {mode === "new" ? (
                <View style={styles.fieldGroup}>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    maxLength={MAX_PLAYLIST_NAME_LENGTH}
                    placeholder={m.guided.playlists.namePlaceholder}
                    placeholderTextColor={colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                  />
                  <TextInput
                    value={newDescription}
                    onChangeText={setNewDescription}
                    maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
                    placeholder={m.guided.playlists.descriptionPlaceholder}
                    placeholderTextColor={colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                  />
                </View>
              ) : (
                <View style={styles.existingList}>
                  {playlists.map((pl) => {
                    const active =
                      (targetPlaylistId || playlists[0]?.id) === pl.id;
                    return (
                      <Pressable
                        key={pl.id}
                        onPress={() => {
                          triggerSelectionHaptic();
                          setTargetPlaylistId(pl.id);
                        }}
                        style={[
                          styles.playlistOption,
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
                            styles.playlistOptionText,
                            { color: colors.foreground },
                          ]}
                          numberOfLines={1}
                        >
                          {pl.name}
                        </Text>
                        <Text
                          style={[
                            styles.playlistOptionCount,
                            { color: colors.foregroundMuted },
                          ]}
                        >
                          {m.guided.playlists.trackCount(pl.trackIds.length)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <View style={styles.selectionHeader}>
                <Text
                  style={[styles.selectionCount, { color: colors.foregroundMuted }]}
                >
                  {m.guided.playlists.selectedTracksSummary(
                    selectedCount,
                    resolved.tracks.length
                  )}
                </Text>
                <View style={styles.selectionActions}>
                  <Pressable
                    onPress={() =>
                      setSelectedIds(
                        new Set(resolved.tracks.map((t) => t.externalId))
                      )
                    }
                  >
                    <Text style={[styles.linkText, { color: colors.accent }]}>
                      {m.guided.playlists.selectAll}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setSelectedIds(new Set())}>
                    <Text
                      style={[styles.linkText, { color: colors.foregroundMuted }]}
                    >
                      {m.guided.playlists.deselectAll}
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.trackPreviewList}>
                {resolved.tracks.map((track, idx) => {
                  const checked = selectedIds.has(track.externalId);
                  return (
                    <Pressable
                      key={track.externalId}
                      onPress={() => toggleTrack(track.externalId)}
                      style={[
                        styles.trackRow,
                        {
                          backgroundColor: checked
                            ? colors.accentSoft
                            : colors.surface,
                          borderColor: checked ? colors.accent : colors.border,
                          opacity: checked ? 1 : 0.65,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            backgroundColor: checked
                              ? colors.accent
                              : "transparent",
                            borderColor: checked
                              ? colors.accent
                              : colors.foregroundMuted,
                          },
                        ]}
                      >
                        {checked ? <Check size={12} color="#ffffff" /> : null}
                      </View>
                      <View style={styles.trackMeta}>
                        <Text
                          style={[styles.trackTitle, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {idx + 1}. {track.title}
                        </Text>
                        {track.author ? (
                          <Text
                            style={[
                              styles.trackAuthor,
                              { color: colors.foregroundMuted },
                            ]}
                            numberOfLines={1}
                          >
                            {track.author}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                disabled={importing || selectedCount === 0}
                onPress={() => void handleConfirmImport()}
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: importing || selectedCount === 0 ? 0.5 : 1,
                  },
                ]}
              >
                {importing ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {mode === "new"
                      ? m.guided.playlists.importConfirmNew(selectedCount)
                      : m.guided.playlists.importConfirmExisting(selectedCount)}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "600" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 40,
  },
  label: { fontSize: 13, fontWeight: "600" },
  urlRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  urlInput: { flex: 1 },
  resolveBtn: {
    width: 44,
    height: 44,
    borderRadius: BODHI_RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  previewSection: { gap: 12, marginTop: 4 },
  noticeBox: {
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    padding: 12,
  },
  noticeText: { fontSize: 12, lineHeight: 17 },
  segmentRow: {
    flexDirection: "row",
    borderRadius: BODHI_RADIUS.md,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BODHI_RADIUS.sm,
    alignItems: "center",
  },
  segmentText: { fontSize: 12, fontWeight: "600" },
  fieldGroup: { gap: 8 },
  existingList: { gap: 8 },
  playlistOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  playlistOptionText: { fontSize: 13, fontWeight: "600", flex: 1 },
  playlistOptionCount: { fontSize: 11 },
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectionCount: { fontSize: 12 },
  selectionActions: { flexDirection: "row", gap: 14 },
  linkText: { fontSize: 12, fontWeight: "600" },
  trackPreviewList: { gap: 8 },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: BODHI_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  trackMeta: { flex: 1, gap: 2 },
  trackTitle: { fontSize: 13, fontWeight: "500" },
  trackAuthor: { fontSize: 11 },
  submitBtn: {
    marginTop: 4,
    borderRadius: BODHI_RADIUS.full,
    paddingVertical: 13,
    alignItems: "center",
  },
  submitBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
});
