import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check,
  ExternalLink,
  EyeOff,
  ListMusic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Star,
  X,
} from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { MIN_SAVEABLE_EARLY_STOP_SECONDS } from "@bodhi/core/history/stats";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { formatElapsedDisplay } from "@bodhi/core/timer/engine";
import {
  filterOfflinePlayablePlaylistTracks,
  resolvePlaylistTracks,
} from "@bodhi/core/tracks/playlists";
import {
  buildSoundCloudEmbedUrl,
  isAudioStreamProvider,
  TRACK_PROVIDER_LABELS,
} from "@bodhi/core/tracks/providers";
import { EarlyFinishCard } from "../../components/common/EarlyFinishCard";
import { ZenDimOverlay } from "../../components/common/ZenDimOverlay";
import { bodhiApi } from "../../platform/api";
import { nativeAudioEngine } from "../../platform/audio/native-engine";
import {
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from "../../platform/haptics";
import {
  getLocalAudioUri,
  getOfflineAudioIndex,
  subscribeOfflineAudioIndex,
} from "../../platform/offline-audio";
import { getAccessToken } from "../../platform/secure-tokens";
import {
  readGuidedAutoAdvance,
  timerPreferencesStore,
  writeGuidedAutoAdvance,
} from "../../platform/storage";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

export default function GuidedSessionPlayerScreen() {
  const { id, playlistId, index } = useLocalSearchParams<{
    id: string;
    playlistId?: string;
    index?: string;
  }>();
  const router = useRouter();
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const { isOnline, tracks, playlists, setTracks, saveSession } =
    useBodhiData();

  const offlineAudio = useSyncExternalStore(
    subscribeOfflineAudioIndex,
    getOfflineAudioIndex,
    getOfflineAudioIndex
  );

  const activePlaylist = useMemo(
    () => (playlistId ? playlists.find((p) => p.id === playlistId) ?? null : null),
    [playlistId, playlists]
  );

  const playlistQueue = useMemo(() => {
    if (!activePlaylist) return null;
    return isOnline
      ? resolvePlaylistTracks(activePlaylist, tracks)
      : filterOfflinePlayablePlaylistTracks(activePlaylist, tracks, offlineAudio);
  }, [activePlaylist, isOnline, offlineAudio, tracks]);

  const initialQueueIndex = useMemo(() => {
    if (!playlistQueue || playlistQueue.length === 0) return 0;
    const parsed = index !== undefined ? Number.parseInt(index, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < playlistQueue.length) {
      return parsed;
    }
    const found = playlistQueue.findIndex((item) => item.id === id);
    return found >= 0 ? found : 0;
  }, [id, index, playlistQueue]);

  const [queueIndex, setQueueIndex] = useState<number>(initialQueueIndex);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(() =>
    readGuidedAutoAdvance()
  );
  const [completedState, setCompletedState] = useState<{
    durationSec: number;
  } | null>(null);

  const track = useMemo(() => {
    if (playlistQueue && playlistQueue.length > 0) {
      const clamped = Math.max(0, Math.min(queueIndex, playlistQueue.length - 1));
      return playlistQueue[clamped] ?? null;
    }
    return tracks.find((t) => t.id === id) ?? null;
  }, [id, playlistQueue, queueIndex, tracks]);

  const timerPrefs = timerPreferencesStore.getSnapshot();

  const [audioSource, setAudioSource] = useState<
    string | { uri: string; headers?: Record<string, string> } | null
  >(null);
  const [companionActive, setCompanionActive] = useState(false);
  const [companionPaused, setCompanionPaused] = useState(false);
  const [companionElapsedMs, setCompanionElapsedMs] = useState(0);
  const [zenDim, setZenDim] = useState(false);
  const [showEarlyFinish, setShowEarlyFinish] = useState(false);
  const [embedError, setEmbedError] = useState(false);

  const startedAtRef = useRef<string>(new Date().toISOString());
  const companionStartEpochRef = useRef<number>(Date.now());
  const loggedCompletionRef = useRef(false);
  const pendingAutoPlayRef = useRef(false);

  const isNativeAudio = track ? isAudioStreamProvider(track.provider) : false;
  const hasPrevious = Boolean(playlistQueue && queueIndex > 0);
  const hasNext = Boolean(
    playlistQueue && queueIndex + 1 < playlistQueue.length
  );
  const nextTrack =
    playlistQueue && hasNext ? playlistQueue[queueIndex + 1] : null;

  // Resolve local offline file:// URI or Bearer-authenticated stream URL
  useEffect(() => {
    if (!track || !isNativeAudio) {
      setAudioSource(null);
      return;
    }

    let cancelled = false;
    const resolve = async () => {
      const localUri = getLocalAudioUri(track.id);
      if (localUri) {
        if (!cancelled) setAudioSource(localUri);
        return;
      }

      const token = await getAccessToken();
      const url =
        track.provider === "GOOGLE_DRIVE"
          ? bodhiApi.getAudioStreamUrl(track.id)
          : track.url;
      const headers =
        track.provider === "GOOGLE_DRIVE" && token
          ? { Authorization: `Bearer ${token}` }
          : undefined;

      if (!cancelled) {
        setAudioSource(headers ? { uri: url, headers } : { uri: url });
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [isNativeAudio, track]);

  const player = useAudioPlayer(audioSource, {
    updateInterval: 250,
    keepAudioSessionActive: true,
  });
  const playerStatus = useAudioPlayerStatus(player);

  // Trigger autoplay once the next track's native audio source is loaded
  useEffect(() => {
    if (!pendingAutoPlayRef.current || !isNativeAudio || !audioSource) return;
    if (playerStatus.isLoaded) {
      pendingAutoPlayRef.current = false;
      player.play();
    }
  }, [audioSource, isNativeAudio, player, playerStatus.isLoaded]);

  useKeepAwake(
    playerStatus.playing || (companionActive && !companionPaused)
      ? "bodhi-guided-player"
      : undefined
  );

  // Sync Lock Screen metadata for native audio tracks (never for External Companion!)
  useEffect(() => {
    if (!track || !isNativeAudio || companionActive) return;
    try {
      player.setActiveForLockScreen(true, {
        title: track.title,
        artist: track.author ?? "Bodhi Guided Meditation",
      });
    } catch {
      // Safe fallback
    }
    return () => {
      try {
        player.setActiveForLockScreen(false);
      } catch {
        // Ignore
      }
    };
  }, [companionActive, isNativeAudio, player, track]);

  const switchQueueIndex = useCallback(
    (nextIdx: number, autoStart: boolean) => {
      if (!playlistQueue || nextIdx < 0 || nextIdx >= playlistQueue.length) {
        return;
      }
      if (isNativeAudio) {
        player.pause();
      }
      loggedCompletionRef.current = false;
      startedAtRef.current = new Date().toISOString();
      pendingAutoPlayRef.current = autoStart;
      setCompletedState(null);
      setCompanionActive(false);
      setCompanionPaused(false);
      setCompanionElapsedMs(0);
      setEmbedError(false);
      setShowEarlyFinish(false);
      setQueueIndex(nextIdx);
    },
    [isNativeAudio, player, playlistQueue]
  );

  const finishTrackSession = useCallback(
    async (completed: boolean, actualSec: number, exitAfter = false) => {
      if (!track || loggedCompletionRef.current) return;
      loggedCompletionRef.current = true;

      const shouldAutoAdvance = Boolean(
        completed &&
          !exitAfter &&
          activePlaylist &&
          autoAdvance &&
          hasNext &&
          !companionActive
      );

      if (isNativeAudio) {
        player.pause();
      }

      await saveSession({
        mode: "TRACK",
        trackId: track.id,
        trackTitle: track.title,
        trackProvider: track.provider,
        plannedDurationSec:
          playerStatus.duration > 0 ? Math.round(playerStatus.duration) : null,
        actualDurationSec: Math.max(1, actualSec),
        completed,
        startedAt: startedAtRef.current,
      });

      if (shouldAutoAdvance) {
        switchQueueIndex(queueIndex + 1, true);
        return;
      }

      setZenDim(false);
      triggerSuccessHaptic();
      nativeAudioEngine.playBellStrikes(
        timerPrefs.endBell,
        timerPrefs.endBellStrikes,
        timerPrefs.bellVolume
      );

      if (exitAfter || !activePlaylist) {
        router.back();
        return;
      }

      setCompletedState({ durationSec: Math.max(1, actualSec) });
    },
    [
      activePlaylist,
      autoAdvance,
      companionActive,
      hasNext,
      isNativeAudio,
      player,
      playerStatus.duration,
      queueIndex,
      router,
      saveSession,
      switchQueueIndex,
      timerPrefs.bellVolume,
      timerPrefs.endBell,
      timerPrefs.endBellStrikes,
      track,
    ]
  );

  // Auto-log & ring closing bell (or auto-advance) when native audio finishes naturally
  useEffect(() => {
    if (
      isNativeAudio &&
      playerStatus.didJustFinish &&
      !loggedCompletionRef.current
    ) {
      const dur = Math.max(
        1,
        Math.round(playerStatus.duration || playerStatus.currentTime)
      );
      void finishTrackSession(true, dur, false);
    }
  }, [
    finishTrackSession,
    isNativeAudio,
    playerStatus.currentTime,
    playerStatus.didJustFinish,
    playerStatus.duration,
  ]);

  // Drift-free count-up loop for External Companion Mode (YouTube / SoundCloud)
  useEffect(() => {
    if (!companionActive || companionPaused) return;
    const interval = setInterval(() => {
      setCompanionElapsedMs(Date.now() - companionStartEpochRef.current);
    }, 200);
    return () => clearInterval(interval);
  }, [companionActive, companionPaused]);

  const startExternalCompanion = () => {
    if (!track) return;
    triggerSelectionHaptic();
    // Clear Bodhi lock screen so it never competes with YouTube / SoundCloud app
    nativeAudioEngine.clearLockScreen();
    startedAtRef.current = new Date().toISOString();
    companionStartEpochRef.current = Date.now();
    setCompanionElapsedMs(0);
    setCompanionPaused(false);
    setCompanionActive(true);
    void Linking.openURL(track.url);
  };

  const toggleFavorite = async () => {
    if (!track) return;
    triggerSelectionHaptic();
    const nextFav = !track.isFavorite;
    setTracks((prev) =>
      prev.map((t) => (t.id === track.id ? { ...t, isFavorite: nextFav } : t))
    );
    await bodhiApi.updateTrack(track.id, { isFavorite: nextFav }).catch(() => {});
  };

  const handleToggleAutoAdvance = () => {
    triggerSelectionHaptic();
    const next = !autoAdvance;
    setAutoAdvance(next);
    writeGuidedAutoAdvance(next);
  };

  if (!track) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.background }]}
      >
        <View style={styles.missingBox}>
          <Text style={{ color: colors.foreground }}>Track not found.</Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={{ color: colors.accent }}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentSec = companionActive
    ? Math.floor(companionElapsedMs / 1000)
    : Math.floor(playerStatus.currentTime || 0);

  const handleRequestFinish = () => {
    if (completedState) {
      router.back();
      return;
    }
    if (currentSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
      if (isNativeAudio) player.pause();
      if (companionActive) setCompanionPaused(true);
      setShowEarlyFinish(true);
    } else {
      if (isNativeAudio) player.pause();
      router.back();
    }
  };

  const embedUrl =
    track.provider === "YOUTUBE"
      ? `https://www.youtube.com/embed/${encodeURIComponent(track.externalId)}?playsinline=1&rel=0`
      : track.provider === "SOUNDCLOUD"
        ? buildSoundCloudEmbedUrl(track.url)
        : null;

  const progressRatio =
    isNativeAudio && playerStatus.duration > 0
      ? Math.min(1, playerStatus.currentTime / playerStatus.duration)
      : 0;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={handleRequestFinish}
          style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
        >
          <X size={18} color={colors.foreground} />
        </Pressable>

        <View style={styles.headerMeta}>
          <Text
            style={[styles.trackTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {track.title}
          </Text>
          <Text style={[styles.providerLabel, { color: colors.foregroundMuted }]}>
            {TRACK_PROVIDER_LABELS[track.provider]}
          </Text>
        </View>

        <Pressable
          onPress={() => void toggleFavorite()}
          style={[styles.iconBtn, { backgroundColor: colors.surfaceMuted }]}
        >
          <Star
            size={18}
            color={track.isFavorite ? colors.warmAmber : colors.foregroundMuted}
            fill={track.isFavorite ? colors.warmAmber : "transparent"}
          />
        </Pressable>
      </View>

      {activePlaylist && playlistQueue && !completedState ? (
        <View style={styles.playlistBarWrap}>
          <View
            style={[
              styles.playlistBar,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.playlistBarMeta}>
              <ListMusic size={14} color={colors.accent} />
              <View style={styles.playlistBarText}>
                <Text
                  style={[styles.playlistBarName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {activePlaylist.name}
                </Text>
                <Text
                  style={[
                    styles.playlistBarCount,
                    { color: colors.foregroundMuted },
                  ]}
                >
                  {m.guided.player.queueProgress(
                    queueIndex + 1,
                    playlistQueue.length
                  )}
                </Text>
              </View>
            </View>

            <View style={styles.playlistBarControls}>
              <Pressable
                onPress={handleToggleAutoAdvance}
                style={[
                  styles.autoAdvanceChip,
                  {
                    backgroundColor: autoAdvance
                      ? colors.accentSoft
                      : colors.surfaceMuted,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.autoAdvanceText,
                    {
                      color: autoAdvance
                        ? colors.accent
                        : colors.foregroundMuted,
                    },
                  ]}
                >
                  {m.guided.player.autoAdvance}:{" "}
                  {autoAdvance ? m.common.on : m.common.off}
                </Text>
              </Pressable>

              <Pressable
                disabled={!hasPrevious}
                onPress={() => {
                  triggerSelectionHaptic();
                  switchQueueIndex(queueIndex - 1, true);
                }}
                style={[styles.skipBtn, { opacity: hasPrevious ? 1 : 0.3 }]}
              >
                <SkipBack size={15} color={colors.foreground} />
              </Pressable>

              <Pressable
                disabled={!hasNext}
                onPress={() => {
                  triggerSelectionHaptic();
                  switchQueueIndex(queueIndex + 1, true);
                }}
                style={[styles.skipBtn, { opacity: hasNext ? 1 : 0.3 }]}
              >
                <SkipForward size={15} color={colors.foreground} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.content}>
        {completedState ? (
          <View style={styles.nativePlayerBox}>
            <View
              style={[
                styles.completeBadge,
                { backgroundColor: colors.accentSoft },
              ]}
            >
              <Check size={28} color={colors.accent} />
            </View>
            <Text style={[styles.completeTitle, { color: colors.foreground }]}>
              {hasNext
                ? m.guided.player.sessionComplete
                : m.guided.player.playlistComplete}
            </Text>
            <Text
              style={[styles.completeSub, { color: colors.foregroundMuted }]}
            >
              {track.title}
            </Text>
            {activePlaylist && playlistQueue ? (
              <Text
                style={[styles.completeSub, { color: colors.foregroundMuted }]}
              >
                {activePlaylist.name} ·{" "}
                {m.guided.player.queueProgress(
                  queueIndex + 1,
                  playlistQueue.length
                )}
              </Text>
            ) : null}

            <View style={styles.companionBtns}>
              {hasNext ? (
                <Pressable
                  onPress={() => {
                    triggerSelectionHaptic();
                    switchQueueIndex(queueIndex + 1, true);
                  }}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={styles.primaryBtnText} numberOfLines={1}>
                    {nextTrack
                      ? m.guided.player.nextTrackWithTitle(nextTrack.title)
                      : m.guided.player.nextTrack}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => {
                  triggerSelectionHaptic();
                  loggedCompletionRef.current = false;
                  startedAtRef.current = new Date().toISOString();
                  setCompletedState(null);
                  if (isNativeAudio) {
                    player.seekTo(0);
                    player.play();
                  }
                }}
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <View style={styles.inlineRow}>
                  <RotateCcw size={14} color={colors.foreground} />
                  <Text
                    style={[
                      styles.secondaryBtnText,
                      { color: colors.foreground },
                    ]}
                  >
                    {m.guided.player.replay}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => router.back()}
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryBtnText,
                    { color: colors.foregroundMuted },
                  ]}
                >
                  {m.guided.player.backToPlaylist}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : isNativeAudio ? (
          <View style={styles.nativePlayerBox}>
            <Text style={[styles.bigClock, { color: colors.foreground }]}>
              {formatElapsedDisplay((playerStatus.currentTime || 0) * 1000)}
            </Text>
            {playerStatus.duration > 0 ? (
              <Text style={[styles.totalClock, { color: colors.foregroundMuted }]}>
                / {formatElapsedDisplay(playerStatus.duration * 1000)}
              </Text>
            ) : null}

            <View
              style={[
                styles.progressTrack,
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.accent,
                    width: `${Math.round(progressRatio * 100)}%`,
                  },
                ]}
              />
            </View>

            <Pressable
              onPress={() => {
                triggerSelectionHaptic();
                if (playerStatus.playing) {
                  player.pause();
                } else {
                  player.play();
                }
              }}
              style={[styles.playCircle, { backgroundColor: colors.accent }]}
            >
              {playerStatus.playing ? (
                <Pause size={28} color="#ffffff" />
              ) : (
                <Play size={28} color="#ffffff" fill="#ffffff" />
              )}
            </Pressable>
          </View>
        ) : companionActive ? (
          <View style={styles.nativePlayerBox}>
            <Text
              style={[styles.companionBadge, { color: colors.warmAmber }]}
            >
              {m.guided.player.externalListening(
                TRACK_PROVIDER_LABELS[track.provider]
              )}
            </Text>
            <Text style={[styles.bigClock, { color: colors.foreground }]}>
              {formatElapsedDisplay(companionElapsedMs)}
            </Text>

            <View style={styles.companionBtns}>
              <Pressable
                onPress={() => {
                  if (companionPaused) {
                    companionStartEpochRef.current =
                      Date.now() - companionElapsedMs;
                    setCompanionPaused(false);
                  } else {
                    setCompanionPaused(true);
                  }
                }}
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.primaryBtnText}>
                  {companionPaused ? m.timer.resume : m.timer.pause}
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  void finishTrackSession(
                    true,
                    Math.max(1, Math.floor(companionElapsedMs / 1000)),
                    false
                  )
                }
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: colors.accentSoft },
                ]}
              >
                <Text
                  style={[styles.secondaryBtnText, { color: colors.accent }]}
                >
                  {m.guided.player.completeSession}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.back()}
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryBtnText,
                    { color: colors.foregroundMuted },
                  ]}
                >
                  {m.guided.player.discardSession}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.embedBox}>
            {embedUrl && !embedError ? (
              <View style={styles.webviewContainer}>
                <WebView
                  key={track.id}
                  source={{ uri: embedUrl }}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  onError={() => setEmbedError(true)}
                  style={styles.webview}
                />
              </View>
            ) : (
              <View
                style={[
                  styles.embedFallback,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.fallbackText,
                    { color: colors.foregroundMuted },
                  ]}
                >
                  {m.guided.player.ytLoadError}
                </Text>
              </View>
            )}

            <Pressable
              onPress={startExternalCompanion}
              style={[
                styles.companionTrigger,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <ExternalLink size={15} color={colors.accent} />
              <Text
                style={[
                  styles.companionTriggerText,
                  { color: colors.foreground },
                ]}
              >
                {m.guided.player.openExternalAndTrack(
                  TRACK_PROVIDER_LABELS[track.provider]
                )}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Shared Bottom Action Bar (Zen Dim + Finish) */}
        {!completedState ? (
          <View style={styles.bottomActions}>
            <Pressable
              onPress={() => setZenDim(true)}
              style={[
                styles.pillBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <EyeOff size={14} color={colors.foregroundMuted} />
              <Text style={[styles.pillText, { color: colors.foregroundMuted }]}>
                {m.timer.dimScreen}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleRequestFinish}
              style={[
                styles.pillBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Square size={14} color={colors.foregroundMuted} />
              <Text style={[styles.pillText, { color: colors.foregroundMuted }]}>
                {m.timer.finish}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ZenDimOverlay
        visible={zenDim}
        timeText={formatElapsedDisplay(currentSec * 1000)}
        subtitle={track.title}
        onWake={() => setZenDim(false)}
      />

      <EarlyFinishCard
        visible={showEarlyFinish}
        elapsedLabel={formatElapsedDisplay(currentSec * 1000)}
        onSave={() => {
          setShowEarlyFinish(false);
          void finishTrackSession(false, currentSec, true);
        }}
        onDiscard={() => {
          setShowEarlyFinish(false);
          router.back();
        }}
        onResume={() => {
          setShowEarlyFinish(false);
          if (isNativeAudio) player.play();
          if (companionActive) {
            companionStartEpochRef.current = Date.now() - companionElapsedMs;
            setCompanionPaused(false);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  missingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  backLink: { padding: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerMeta: { flex: 1, alignItems: "center" },
  trackTitle: { fontSize: 15, fontWeight: "600" },
  providerLabel: { fontSize: 12 },
  playlistBarWrap: {
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  playlistBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  playlistBarMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  playlistBarText: { flex: 1 },
  playlistBarName: { fontSize: 12, fontWeight: "600" },
  playlistBarCount: { fontSize: 10 },
  playlistBarControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  autoAdvanceChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BODHI_RADIUS.full,
  },
  autoAdvanceText: { fontSize: 10, fontWeight: "600" },
  skipBtn: { padding: 4 },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "space-between",
    paddingBottom: 24,
  },
  nativePlayerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  completeBadge: {
    width: 64,
    height: 64,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  completeTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  completeSub: { fontSize: 13, textAlign: "center" },
  bigClock: {
    fontSize: 48,
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
  },
  totalClock: { fontSize: 14, fontVariant: ["tabular-nums"] },
  progressTrack: {
    width: "100%",
    height: 6,
    borderRadius: BODHI_RADIUS.full,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: BODHI_RADIUS.full },
  playCircle: {
    marginTop: 12,
    width: 72,
    height: 72,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
  },
  companionBadge: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  companionBtns: {
    width: "100%",
    maxWidth: 280,
    gap: 10,
    marginTop: 12,
  },
  primaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 13, fontWeight: "600" },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  embedBox: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
  },
  webviewContainer: {
    width: "100%",
    height: 240,
    borderRadius: BODHI_RADIUS.lg,
    overflow: "hidden",
  },
  webview: { flex: 1 },
  embedFallback: {
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 20,
  },
  fallbackText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  companionTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  companionTriggerText: { fontSize: 14, fontWeight: "600" },
  bottomActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  pillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: BODHI_RADIUS.full,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: "500" },
});
