import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ExternalLink,
  EyeOff,
  Pause,
  Play,
  Square,
  Star,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { MIN_SAVEABLE_EARLY_STOP_SECONDS } from "@bodhi/core/history/stats";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { formatElapsedDisplay } from "@bodhi/core/timer/engine";
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
import { getLocalAudioUri } from "../../platform/offline-audio";
import { getAccessToken } from "../../platform/secure-tokens";
import { timerPreferencesStore } from "../../platform/storage";
import { useBodhiData } from "../../state/AppDataContext";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

export default function GuidedSessionPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();
  const { tracks, setTracks, saveSession } = useBodhiData();

  const track = tracks.find((t) => t.id === id) ?? null;
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

  const isNativeAudio = track ? isAudioStreamProvider(track.provider) : false;

  // Resolve local offline file:// URI or Bearer-authenticated stream URL
  useEffect(() => {
    if (!track || !isNativeAudio) return;

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

  const finishTrackSession = useCallback(
    async (completed: boolean, actualSec: number) => {
      if (!track || loggedCompletionRef.current) return;
      loggedCompletionRef.current = true;

      if (isNativeAudio) {
        player.pause();
      }
      setZenDim(false);
      triggerSuccessHaptic();
      nativeAudioEngine.playBellStrikes(
        timerPrefs.endBell,
        timerPrefs.endBellStrikes,
        timerPrefs.bellVolume
      );

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

      router.back();
    },
    [
      isNativeAudio,
      player,
      playerStatus.duration,
      router,
      saveSession,
      timerPrefs.bellVolume,
      timerPrefs.endBell,
      timerPrefs.endBellStrikes,
      track,
    ]
  );

  // Auto-log & ring closing bell when native audio track finishes naturally
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
      void finishTrackSession(true, dur);
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

      <View style={styles.content}>
        {isNativeAudio ? (
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
              External Companion Mode
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
                  Discard without saving
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.embedBox}>
            {embedUrl && !embedError ? (
              <View style={styles.webviewContainer}>
                <WebView
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
                  Embedded playback is unavailable for this link. Open it in the
                  external app and track your session in Bodhi.
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
                Open in {TRACK_PROVIDER_LABELS[track.provider]} & Track
              </Text>
            </Pressable>
          </View>
        )}

        {/* Shared Bottom Action Bar (Zen Dim + Finish) */}
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
          void finishTrackSession(false, currentSec);
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
    gap: 16,
  },
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
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: BODHI_RADIUS.full,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 13, fontWeight: "600" },
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
