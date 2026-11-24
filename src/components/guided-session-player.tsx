"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  EyeOff,
  Headphones,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Star,
  X,
} from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import { EarlyFinishCard } from "@/components/early-finish-card";
import { useI18n } from "@/components/i18n-provider";
import { ZenDimOverlay } from "@/components/zen-dim-overlay";
import { MeditationAudioEngine } from "@/lib/audio/engine";
import { DEFAULT_END_BELL_ID, type BellSoundId } from "@/lib/audio/sounds";
import {
  saveMeditationSession,
  updateMeditationSessionNote,
} from "@/lib/history/client";
import {
  MIN_SAVEABLE_EARLY_STOP_SECONDS,
  formatSessionDuration,
} from "@/lib/history/stats";
import type { MeditationSessionItem } from "@/lib/history/types";
import {
  clearMediaSession,
  setMediaSessionActionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "@/lib/media-session";
import {
  formatBytesLabel,
  getOfflineGuidedServerSnapshot,
  getOfflineGuidedSnapshot,
  getOfflineTrackAudioBlobUrl,
  removeTrackAudioOffline,
  saveTrackAudioOffline,
  subscribeOfflineGuided,
} from "@/lib/offline/audio-cache";
import { formatElapsedDisplay } from "@/lib/timer/engine";
import {
  getTimerPreferencesServerSnapshot,
  getTimerPreferencesSnapshot,
  subscribeTimerPreferences,
} from "@/lib/timer/preferences";
import type { BellStrikeCount } from "@/lib/timer/types";
import {
  buildSoundCloudEmbedUrl,
  isAudioStreamProvider,
} from "@/lib/tracks/providers";
import type { FavoriteTrackItem } from "@/lib/tracks/types";
import {
  buildYouTubePlayerVars,
  classifyYouTubePlayerError,
  isRetryableYouTubeError,
  supportsExternalYouTubeCompanion,
  type YouTubePlayerErrorKind,
} from "@/lib/tracks/youtube-player";
import { useWakeLock } from "@/lib/wake-lock";

type PlaybackState = "loading" | "ready" | "playing" | "paused" | "completed";
type PlayerErrorKey =
  | "youtube"
  | "youtube_embed_disabled"
  | "youtube_unavailable"
  | "youtube_config"
  | "soundcloud"
  | "direct_audio"
  | "google_drive";

interface YouTubePlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getIframe?: () => HTMLIFrameElement | null;
  destroy: () => void;
}

interface YouTubeAPI {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YouTubePlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
  };
}

interface SoundCloudWidgetInstance {
  bind: (event: string, callback: () => void) => void;
  unbind: (event: string) => void;
  play: () => void;
  pause: () => void;
  seekTo: (milliseconds: number) => void;
}

interface SoundCloudAPI {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidgetInstance) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      ERROR?: string;
    };
  };
}

declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
    SC?: SoundCloudAPI;
  }
}

function loadScriptOnce(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${src}`)),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${src}`)),
      { once: true }
    );
    document.head.appendChild(script);
  });
}

function loadYouTubeApi(): Promise<YouTubeAPI> {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube IFrame API unavailable"));
      }
    };

    void loadScriptOnce(
      "https://www.youtube.com/iframe_api",
      "bodhi-youtube-iframe-api"
    ).catch(reject);
  });
}

interface GuidedSessionPlayerProps {
  track: FavoriteTrackItem;
  closingBellEnabled: boolean;
  isAuthenticated?: boolean;
  userId?: string | null;
  isOnline?: boolean;
  isTogglingFavorite?: boolean;
  onToggleFavorite?: (track: FavoriteTrackItem) => void;
  onToggleClosingBell: () => void;
  onExit: () => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
}

export function GuidedSessionPlayer({
  track,
  closingBellEnabled,
  isAuthenticated = false,
  userId = null,
  isOnline = true,
  isTogglingFavorite = false,
  onToggleFavorite,
  onToggleClosingBell,
  onExit,
  onSessionSaved,
  onSessionUpdated,
}: GuidedSessionPlayerProps) {
  const { m } = useI18n();
  const timerPrefs = useSyncExternalStore(
    subscribeTimerPreferences,
    getTimerPreferencesSnapshot,
    getTimerPreferencesServerSnapshot
  );
  const offlineGuided = useSyncExternalStore(
    subscribeOfflineGuided,
    getOfflineGuidedSnapshot,
    getOfflineGuidedServerSnapshot
  );

  const offlineMeta = offlineGuided.savedAudio[track.id] ?? null;
  const isSavedOffline = Boolean(offlineMeta);

  // Sync the closing bell sound, strikes, and volume with the user's Timer settings
  const closingBellSoundId: BellSoundId =
    timerPrefs.endBell === "none" ? DEFAULT_END_BELL_ID : timerPrefs.endBell;
  const closingBellStrikes: BellStrikeCount = timerPrefs.endBellStrikes;
  const closingBellVolume: number = timerPrefs.bellVolume;
  const closingBellName = m.sounds.bells[closingBellSoundId];

  const isStreamAudio = isAudioStreamProvider(track.provider);

  const [playbackState, setPlaybackState] = useState<PlaybackState>(
    isStreamAudio ? "ready" : "loading"
  );
  const [playerErrorKey, setPlayerErrorKey] = useState<PlayerErrorKey | null>(
    null
  );
  const [isExternalMode, setIsExternalMode] = useState<boolean>(false);
  const [externalElapsedMs, setExternalElapsedMs] = useState<number>(0);
  const [embedRetryNonce, setEmbedRetryNonce] = useState<number>(0);
  const [isDimmed, setIsDimmed] = useState<boolean>(false);
  const [offlineBlobUrl, setOfflineBlobUrl] = useState<string | null>(null);
  const [isTogglingOffline, setIsTogglingOffline] = useState<boolean>(false);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  // History logging state
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [completedDurationSec, setCompletedDurationSec] = useState<number>(0);
  const [noteInput, setNoteInput] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [noteSaved, setNoteSaved] = useState<boolean>(false);
  const [earlyStopElapsedSec, setEarlyStopElapsedSec] = useState<number | null>(
    null
  );
  const [isSavingEarlyStop, setIsSavingEarlyStop] = useState<boolean>(false);

  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YouTubePlayerInstance | null>(null);
  const scIframeRef = useRef<HTMLIFrameElement | null>(null);
  const scWidgetRef = useRef<SoundCloudWidgetInstance | null>(null);
  const directAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<MeditationAudioEngine | null>(null);
  const closingBellRef = useRef(closingBellEnabled);
  const closingBellSoundRef = useRef<BellSoundId>(closingBellSoundId);
  const closingBellStrikesRef = useRef<BellStrikeCount>(closingBellStrikes);
  const closingBellVolumeRef = useRef<number>(closingBellVolume);
  const lastMediaPositionSecRef = useRef<number>(-1);

  // Accurate active-listening duration tracking (excludes paused intervals)
  const sessionStartedAtRef = useRef<string | null>(null);
  const playSegmentStartRef = useRef<number | null>(null);
  const accumulatedListenMsRef = useRef<number>(0);

  useEffect(() => {
    closingBellRef.current = closingBellEnabled;
  }, [closingBellEnabled]);

  useEffect(() => {
    closingBellSoundRef.current = closingBellSoundId;
  }, [closingBellSoundId]);

  useEffect(() => {
    closingBellStrikesRef.current = closingBellStrikes;
  }, [closingBellStrikes]);

  useEffect(() => {
    closingBellVolumeRef.current = closingBellVolume;
  }, [closingBellVolume]);

  const getAudioEngine = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new MeditationAudioEngine();
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  // Resolve locally cached Blob URL for saved audio tracks (Airplane Mode playback)
  useEffect(() => {
    if (!isStreamAudio) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    void getOfflineTrackAudioBlobUrl(track.id).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      createdUrl = url;
      setOfflineBlobUrl(url);
      if (url) {
        setPlayerErrorKey(null);
      }
    });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isSavedOffline, isStreamAudio, track.id]);

  const handleToggleOfflineSave = useCallback(async () => {
    if (!isStreamAudio) return;
    setOfflineError(null);

    if (isSavedOffline) {
      await removeTrackAudioOffline(track.id);
      return;
    }

    setIsTogglingOffline(true);
    try {
      await saveTrackAudioOffline(track, isAuthenticated);
    } catch {
      setOfflineError(m.guided.errOfflineDownload);
    } finally {
      setIsTogglingOffline(false);
    }
  }, [
    isAuthenticated,
    isSavedOffline,
    isStreamAudio,
    m.guided.errOfflineDownload,
    track,
  ]);

  const syncDirectAudioPosition = useCallback(() => {
    const el = directAudioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const roundedSec = Math.floor(el.currentTime);
    if (roundedSec === lastMediaPositionSecRef.current) return;
    lastMediaPositionSecRef.current = roundedSec;
    setMediaSessionPositionState({
      duration: el.duration,
      position: el.currentTime,
      playbackRate: el.playbackRate || 1,
    });
  }, []);

  const markPlayingStart = useCallback(() => {
    if (!sessionStartedAtRef.current) {
      sessionStartedAtRef.current = new Date().toISOString();
    }
    if (playSegmentStartRef.current === null) {
      playSegmentStartRef.current = Date.now();
    }
  }, []);

  const flushListeningMs = useCallback((): number => {
    if (playSegmentStartRef.current !== null) {
      accumulatedListenMsRef.current += Math.max(
        0,
        Date.now() - playSegmentStartRef.current
      );
      playSegmentStartRef.current = null;
    }
    return accumulatedListenMsRef.current;
  }, []);

  const { isActive: isWakeLockActive } = useWakeLock(
    playbackState === "playing" && !isStreamAudio
  );

  const handleTrackCompleted = useCallback(() => {
    const elapsedSec = Math.max(1, Math.round(flushListeningMs() / 1000));
    setCompletedDurationSec(elapsedSec);
    setIsDimmed(false);
    setPlaybackState("completed");

    if (closingBellRef.current) {
      const audio = getAudioEngine();
      audio.unlock({ bells: [closingBellSoundRef.current] });
      audio.playBellStrikes(
        closingBellSoundRef.current,
        closingBellStrikesRef.current,
        closingBellVolumeRef.current
      );
    }

    if (isAuthenticated) {
      void saveMeditationSession(
        {
          mode: "TRACK",
          trackId: track.id,
          trackTitle: track.title,
          trackProvider: track.provider,
          actualDurationSec: elapsedSec,
          completed: true,
          startedAt: sessionStartedAtRef.current ?? undefined,
          endedAt: new Date().toISOString(),
        },
        userId
      ).then((saved) => {
        if (saved) {
          setSavedSessionId(saved.id);
          onSessionSaved?.(saved);
        }
      });
    }
  }, [
    flushListeningMs,
    getAudioEngine,
    isAuthenticated,
    onSessionSaved,
    track.id,
    track.provider,
    track.title,
    userId,
  ]);

  // Unified Media Session API across Direct Audio, Google Drive, YouTube, and SoundCloud tracks.
  // Cleared during External Companion Mode so Bodhi never competes with the YouTube app's audio session.
  useEffect(() => {
    if (isExternalMode) {
      clearMediaSession();
      return;
    }

    setMediaSessionMetadata({
      title: track.title,
      artist: track.author ?? m.mediaSession.artist,
      album: "Bodhi",
    });

    if (isStreamAudio) {
      setMediaSessionActionHandlers({
        onPlay: () => {
          void directAudioRef.current?.play();
        },
        onPause: () => {
          directAudioRef.current?.pause();
        },
        onSeekBackward: (offset) => {
          const el = directAudioRef.current;
          if (!el) return;
          el.currentTime = Math.max(0, el.currentTime - offset);
        },
        onSeekForward: (offset) => {
          const el = directAudioRef.current;
          if (!el) return;
          const max = Number.isFinite(el.duration)
            ? el.duration
            : el.currentTime + offset;
          el.currentTime = Math.min(max, el.currentTime + offset);
        },
        onStop: () => {
          const el = directAudioRef.current;
          if (!el) return;
          el.pause();
          el.currentTime = 0;
        },
      });
    } else if (track.provider === "YOUTUBE") {
      setMediaSessionActionHandlers({
        onPlay: () => ytPlayerRef.current?.playVideo(),
        onPause: () => ytPlayerRef.current?.pauseVideo(),
        onStop: () => ytPlayerRef.current?.pauseVideo(),
      });
    } else {
      setMediaSessionActionHandlers({
        onPlay: () => scWidgetRef.current?.play(),
        onPause: () => scWidgetRef.current?.pause(),
        onStop: () => scWidgetRef.current?.pause(),
      });
    }

    return () => {
      clearMediaSession();
    };
  }, [
    isExternalMode,
    isStreamAudio,
    m.mediaSession.artist,
    track.author,
    track.provider,
    track.title,
  ]);

  // Sync Media Session playbackState
  useEffect(() => {
    if (isExternalMode) return;
    setMediaSessionPlaybackState(
      playbackState === "playing"
        ? "playing"
        : playbackState === "paused"
          ? "paused"
          : "none"
    );
  }, [isExternalMode, playbackState]);

  // Drift-free count-up display for External Companion Mode (syncs immediately on app return)
  useEffect(() => {
    if (!isExternalMode || playbackState !== "playing") return;

    const syncElapsed = () => {
      const activeSegmentMs =
        playSegmentStartRef.current !== null
          ? Math.max(0, Date.now() - playSegmentStartRef.current)
          : 0;
      setExternalElapsedMs(accumulatedListenMsRef.current + activeSegmentMs);
    };

    const intervalId = window.setInterval(syncElapsed, 250);
    document.addEventListener("visibilitychange", syncElapsed);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", syncElapsed);
    };
  }, [isExternalMode, playbackState]);

  // Mount YouTube IFrame Player API into an unmanaged child node so YouTube's
  // in-place iframe replacement never conflicts with React's unmount reconciliation.
  useEffect(() => {
    if (track.provider !== "YOUTUBE") return;
    let cancelled = false;
    const host = ytHostRef.current;
    if (!host) return;

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host) return;

        host.innerHTML = "";
        const mountNode = document.createElement("div");
        mountNode.className = "h-full w-full";
        host.appendChild(mountNode);

        const applyIframeReferrerPolicy = () => {
          const iframe =
            ytPlayerRef.current?.getIframe?.() ?? host.querySelector("iframe");
          iframe?.setAttribute(
            "referrerpolicy",
            "strict-origin-when-cross-origin"
          );
        };

        ytPlayerRef.current = new YT.Player(mountNode, {
          videoId: track.externalId,
          width: "100%",
          height: "100%",
          playerVars: buildYouTubePlayerVars(
            typeof window !== "undefined" ? window.location.origin : null
          ),
          events: {
            onReady: () => {
              if (!cancelled) {
                applyIframeReferrerPolicy();
                setPlaybackState("ready");
              }
            },
            onStateChange: (event) => {
              if (cancelled) return;
              if (event.data === YT.PlayerState.PLAYING) {
                getAudioEngine().unlock();
                markPlayingStart();
                setEarlyStopElapsedSec(null);
                setPlaybackState("playing");
              } else if (event.data === YT.PlayerState.PAUSED) {
                flushListeningMs();
                setPlaybackState("paused");
              } else if (event.data === YT.PlayerState.ENDED) {
                handleTrackCompleted();
              }
            },
            onError: (event) => {
              if (cancelled) return;
              flushListeningMs();
              try {
                ytPlayerRef.current?.destroy();
              } catch {
                // Ignore teardown errors
              }
              ytPlayerRef.current = null;
              if (host) {
                host.innerHTML = "";
              }
              const kind = classifyYouTubePlayerError(event.data);
              const nextErrorKey: PlayerErrorKey =
                kind === "embed_disabled"
                  ? "youtube_embed_disabled"
                  : kind === "video_unavailable"
                    ? "youtube_unavailable"
                    : kind === "config_error"
                      ? "youtube_config"
                      : "youtube";
              setPlayerErrorKey(nextErrorKey);
              setPlaybackState("ready");
            },
          },
        });

        applyIframeReferrerPolicy();
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerErrorKey("youtube");
          setPlaybackState("ready");
        }
      });

    return () => {
      cancelled = true;
      try {
        ytPlayerRef.current?.destroy();
      } catch {
        // Ignore teardown errors
      }
      ytPlayerRef.current = null;
      if (host) {
        host.innerHTML = "";
      }
    };
  }, [
    flushListeningMs,
    getAudioEngine,
    handleTrackCompleted,
    markPlayingStart,
    track.externalId,
    track.provider,
    embedRetryNonce,
  ]);

  // Mount SoundCloud Widget API
  useEffect(() => {
    if (track.provider !== "SOUNDCLOUD") return;
    let cancelled = false;
    if (!scIframeRef.current) return;

    void loadScriptOnce(
      "https://w.soundcloud.com/player/api.js",
      "bodhi-soundcloud-widget-api"
    )
      .then(() => {
        if (cancelled || !scIframeRef.current || !window.SC?.Widget) return;

        const widget = window.SC.Widget(scIframeRef.current);
        scWidgetRef.current = widget;
        const Events = window.SC.Widget.Events;

        widget.bind(Events.READY, () => {
          if (!cancelled) setPlaybackState("ready");
        });
        widget.bind(Events.PLAY, () => {
          if (!cancelled) {
            getAudioEngine().unlock();
            markPlayingStart();
            setEarlyStopElapsedSec(null);
            setPlaybackState("playing");
          }
        });
        widget.bind(Events.PAUSE, () => {
          if (!cancelled) {
            flushListeningMs();
            setPlaybackState("paused");
          }
        });
        widget.bind(Events.FINISH, () => {
          if (!cancelled) handleTrackCompleted();
        });
        if (Events.ERROR) {
          widget.bind(Events.ERROR, () => {
            if (cancelled) return;
            flushListeningMs();
            setPlayerErrorKey("soundcloud");
            setPlaybackState("ready");
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerErrorKey("soundcloud");
          setPlaybackState("ready");
        }
      });

    return () => {
      cancelled = true;
      const widget = scWidgetRef.current;
      if (widget && window.SC?.Widget?.Events) {
        try {
          const Events = window.SC.Widget.Events;
          widget.unbind(Events.READY);
          widget.unbind(Events.PLAY);
          widget.unbind(Events.PAUSE);
          widget.unbind(Events.FINISH);
          if (Events.ERROR) {
            widget.unbind(Events.ERROR);
          }
        } catch {
          // Ignore teardown errors if the iframe is already detached
        }
      }
      scWidgetRef.current = null;
    };
  }, [
    embedRetryNonce,
    flushListeningMs,
    getAudioEngine,
    handleTrackCompleted,
    markPlayingStart,
    track.provider,
    track.url,
  ]);

  const pauseActivePlayer = useCallback(() => {
    try {
      if (track.provider === "YOUTUBE") {
        ytPlayerRef.current?.pauseVideo();
      } else if (track.provider === "SOUNDCLOUD") {
        scWidgetRef.current?.pause();
      } else {
        directAudioRef.current?.pause();
      }
    } catch {
      // Ignore pause errors
    }
  }, [track.provider]);

  const handleExitClick = useCallback(() => {
    if (playbackState !== "completed" && isAuthenticated) {
      const elapsedMs = flushListeningMs();
      const elapsedSec = Math.floor(elapsedMs / 1000);
      if (elapsedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
        if (isExternalMode) {
          setExternalElapsedMs(elapsedMs);
        } else {
          pauseActivePlayer();
        }
        setPlaybackState("paused");
        setEarlyStopElapsedSec(elapsedSec);
        return;
      }
    }
    onExit();
  }, [
    flushListeningMs,
    isAuthenticated,
    isExternalMode,
    onExit,
    pauseActivePlayer,
    playbackState,
  ]);

  const handleSaveEarlyStop = useCallback(async () => {
    if (earlyStopElapsedSec === null) return;
    setIsSavingEarlyStop(true);
    const saved = await saveMeditationSession(
      {
        mode: "TRACK",
        trackId: track.id,
        trackTitle: track.title,
        trackProvider: track.provider,
        actualDurationSec: earlyStopElapsedSec,
        completed: false,
        note: noteInput.trim() || null,
        startedAt: sessionStartedAtRef.current ?? undefined,
        endedAt: new Date().toISOString(),
      },
      userId
    );
    setIsSavingEarlyStop(false);
    if (saved) {
      onSessionSaved?.(saved);
    }
    onExit();
  }, [
    earlyStopElapsedSec,
    noteInput,
    onExit,
    onSessionSaved,
    track.id,
    track.provider,
    track.title,
    userId,
  ]);

  const handleSaveCompletedNote = useCallback(async () => {
    if (!savedSessionId) return;
    setIsSavingNote(true);
    const updated = await updateMeditationSessionNote(
      savedSessionId,
      noteInput.trim() || null,
      userId
    );
    setIsSavingNote(false);
    if (updated) {
      setNoteSaved(true);
      onSessionUpdated?.(updated);
    }
  }, [noteInput, onSessionUpdated, savedSessionId, userId]);

  const handleStartExternalSession = useCallback(() => {
    getAudioEngine().unlock({
      bells: [closingBellSoundRef.current],
    });
    accumulatedListenMsRef.current = 0;
    playSegmentStartRef.current = null;
    sessionStartedAtRef.current = null;
    setExternalElapsedMs(0);
    setEarlyStopElapsedSec(null);
    markPlayingStart();
    setIsExternalMode(true);
    setPlaybackState("playing");
  }, [getAudioEngine, markPlayingStart]);

  const handleToggleExternalPause = useCallback(() => {
    if (playbackState === "playing") {
      const elapsed = flushListeningMs();
      setExternalElapsedMs(elapsed);
      setPlaybackState("paused");
    } else if (playbackState === "paused") {
      getAudioEngine().unlock({
        bells: [closingBellSoundRef.current],
      });
      markPlayingStart();
      setEarlyStopElapsedSec(null);
      setPlaybackState("playing");
    }
  }, [flushListeningMs, getAudioEngine, markPlayingStart, playbackState]);

  const handleDiscardExternalSession = useCallback(() => {
    accumulatedListenMsRef.current = 0;
    playSegmentStartRef.current = null;
    sessionStartedAtRef.current = null;
    setExternalElapsedMs(0);
    setEarlyStopElapsedSec(null);
    setIsDimmed(false);
    onExit();
  }, [onExit]);

  const handleRetryEmbed = useCallback(() => {
    setPlayerErrorKey(null);
    setIsExternalMode(false);
    setExternalElapsedMs(0);
    setPlaybackState("loading");
    setEmbedRetryNonce((prev) => prev + 1);
  }, []);

  const handleReplay = useCallback(() => {
    getAudioEngine().unlock();
    accumulatedListenMsRef.current = 0;
    playSegmentStartRef.current = null;
    sessionStartedAtRef.current = null;
    setExternalElapsedMs(0);
    setSavedSessionId(null);
    setNoteInput("");
    setNoteSaved(false);
    setEarlyStopElapsedSec(null);

    if (isExternalMode) {
      setIsExternalMode(false);
      setPlaybackState("ready");
      return;
    }

    setPlaybackState("playing");

    if (track.provider === "YOUTUBE" && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(0, true);
      ytPlayerRef.current.playVideo();
    } else if (track.provider === "SOUNDCLOUD" && scWidgetRef.current) {
      scWidgetRef.current.seekTo(0);
      scWidgetRef.current.play();
    } else if (isStreamAudio && directAudioRef.current) {
      directAudioRef.current.currentTime = 0;
      void directAudioRef.current.play();
    }
  }, [getAudioEngine, isExternalMode, isStreamAudio, track.provider]);

  const providerName = m.guided.providers[track.provider];

  const statusLabel =
    isExternalMode && playbackState === "playing"
      ? m.guided.player.externalListening(providerName)
      : playbackState === "playing"
        ? m.guided.player.listening
        : playbackState === "paused"
          ? m.guided.player.paused
          : playbackState === "completed"
            ? m.guided.player.completed
            : playbackState === "loading"
              ? m.guided.player.loading
              : m.guided.player.ready;

  const youTubeErrorKind: YouTubePlayerErrorKind | null =
    playerErrorKey === "youtube_embed_disabled"
      ? "embed_disabled"
      : playerErrorKey === "youtube_unavailable"
        ? "video_unavailable"
        : playerErrorKey === "youtube_config"
          ? "config_error"
          : playerErrorKey === "youtube"
            ? "playback_error"
            : null;

  const canUseExternalCompanion =
    playerErrorKey === "soundcloud" ||
    (youTubeErrorKind !== null &&
      supportsExternalYouTubeCompanion(youTubeErrorKind));
  const canRetryEmbed =
    playerErrorKey === "soundcloud" ||
    (youTubeErrorKind !== null && isRetryableYouTubeError(youTubeErrorKind));

  const playerError =
    playerErrorKey === "youtube_embed_disabled"
      ? m.guided.player.ytEmbedDisabledError
      : playerErrorKey === "youtube_unavailable"
        ? m.guided.player.ytUnavailableError
        : playerErrorKey === "youtube_config"
          ? m.guided.player.ytConfigError
          : playerErrorKey === "youtube"
            ? m.guided.player.ytLoadError
            : playerErrorKey === "soundcloud"
              ? m.guided.player.scLoadError
              : playerErrorKey === "google_drive"
                ? m.guided.player.googleDriveError
                : playerErrorKey === "direct_audio"
                  ? m.guided.player.directAudioError
                  : null;

  const onlineAudioSrc =
    track.provider === "GOOGLE_DRIVE"
      ? `/api/tracks/${encodeURIComponent(track.id)}/audio`
      : track.url;
  const resolvedAudioSrc =
    offlineBlobUrl ?? (!isOnline && isSavedOffline ? undefined : onlineAudioSrc);

  return (
    <div className="flex flex-1 flex-col justify-between gap-5 py-2">
      {/* Top Session Bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleExitClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
        >
          {playbackState === "playing" || playbackState === "paused" ? (
            <>
              <Square className="h-3 w-3 fill-current" />
              {m.guided.player.finish}
            </>
          ) : (
            <>
              <ArrowLeft className="h-3.5 w-3.5" />
              {m.guided.player.backToGuided}
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          {isAuthenticated && isOnline && onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(track)}
              disabled={isTogglingFavorite}
              aria-pressed={track.isFavorite}
              aria-label={
                track.isFavorite
                  ? m.guided.removeFavoriteAria(track.title)
                  : m.guided.addFavoriteAria(track.title)
              }
              title={
                track.isFavorite
                  ? m.guided.player.favorited
                  : m.guided.player.favorite
              }
              className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                track.isFavorite
                  ? "border-[var(--warm-amber)]/35 bg-[var(--warm-amber)]/12 text-[var(--warm-amber)] hover:bg-[var(--warm-amber)]/20"
                  : "border-black/8 bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] dark:border-white/10"
              }`}
            >
              <Star
                className={`h-3.5 w-3.5 ${track.isFavorite ? "fill-current" : ""}`}
              />
            </button>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-medium tracking-wide text-[var(--accent)] uppercase">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-[var(--accent)] ${
                playbackState === "playing" ? "animate-pulse" : "opacity-50"
              }`}
            />
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Main Player / Completion View */}
      {playbackState === "completed" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--accent-soft)]">
            <BodhiLogo className="h-11 w-11" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              {m.guided.player.sessionComplete}
            </h2>
            <p className="mt-1.5 max-w-xs text-sm text-[var(--foreground-muted)]">
              {track.title}
              {completedDurationSec > 0
                ? ` · ${formatSessionDuration(completedDurationSec)}`
                : ""}
            </p>
            {savedSessionId && (
              <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                <Check className="h-3 w-3" />
                {m.guided.player.savedToHistory}
              </p>
            )}
          </div>

          {savedSessionId && (
            <div className="w-full rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 text-left dark:border-white/10">
              <textarea
                rows={2}
                maxLength={500}
                placeholder={m.timer.addReflectionPlaceholder}
                value={noteInput}
                onChange={(event) => {
                  setNoteInput(event.target.value);
                  setNoteSaved(false);
                }}
                className="w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-[var(--foreground-muted)]">
                  {noteSaved ? m.timer.noteSaved : m.timer.optionalNote}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSaveCompletedNote()}
                  disabled={isSavingNote || !noteInput.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#fcfaf6] disabled:opacity-40 dark:text-[#151917]"
                >
                  {isSavingNote ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  {m.timer.saveNote}
                </button>
              </div>
            </div>
          )}

          <div className="mt-2 grid w-full grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onExit}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[var(--surface)] text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
            >
              {m.guided.player.backToList}
            </button>
            <button
              type="button"
              onClick={handleReplay}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
            >
              <RotateCcw className="h-4 w-4" />
              {m.guided.player.replay}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-4">
          {/* Track Heading */}
          <div className="text-center">
            <span className="inline-block rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--foreground-muted)]">
              {m.guided.providers[track.provider]}
            </span>
            <h2 className="mt-2 line-clamp-2 text-lg font-semibold tracking-tight text-[var(--foreground)]">
              {track.title}
            </h2>
            {track.author && (
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                {track.author}
              </p>
            )}
          </div>

          {/* Embedded Provider Player / External Companion Mode */}
          <div className="overflow-hidden rounded-2xl border border-black/8 bg-[var(--surface)] shadow-xs dark:border-white/10">
            {isExternalMode ? (
              <div className="flex flex-col items-center gap-4 p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Headphones className="h-7 w-7" />
                </div>

                <div>
                  <p className="text-[11px] font-medium tracking-wide text-[var(--foreground-muted)] uppercase">
                    {playbackState === "paused"
                      ? m.guided.player.paused
                      : m.guided.player.externalListening(providerName)}
                  </p>
                  <p className="mt-1 font-mono text-4xl font-semibold tracking-tight text-[var(--foreground)] tabular-nums">
                    {formatElapsedDisplay(externalElapsedMs)}
                  </p>
                </div>

                <div className="grid w-full grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleToggleExternalPause}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-black/8 bg-[var(--background)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                  >
                    {playbackState === "playing" ? (
                      <>
                        <Pause className="h-3.5 w-3.5" />
                        {m.timer.pause}
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        {m.timer.resume}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleTrackCompleted}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {m.guided.player.completeSession}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                  <a
                    href={track.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {m.guided.player.openExternalAgain(providerName)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {earlyStopElapsedSec === null && (
                    <button
                      type="button"
                      onClick={handleDiscardExternalSession}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-red-600 dark:hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                      {m.guided.player.discardSession}
                    </button>
                  )}
                </div>
              </div>
            ) : playerError ? (
              <div className="flex flex-col items-center gap-3.5 p-6 text-center">
                <p className="max-w-xs text-sm leading-relaxed text-[var(--foreground-muted)]">
                  {playerError}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {canUseExternalCompanion ? (
                    <a
                      href={track.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleStartExternalSession}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                    >
                      {m.guided.player.openExternalAndTrack(providerName)}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <a
                      href={track.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
                    >
                      {m.guided.player.openOriginal}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {canRetryEmbed && (
                    <button
                      type="button"
                      onClick={handleRetryEmbed}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-black/8 bg-[var(--background)] px-3.5 py-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {m.guided.player.tryAgain}
                    </button>
                  )}
                </div>
              </div>
            ) : track.provider === "YOUTUBE" ? (
              <div className="relative aspect-video w-full bg-black">
                <div ref={ytHostRef} className="h-full w-full" />
              </div>
            ) : track.provider === "SOUNDCLOUD" ? (
              <iframe
                key={embedRetryNonce}
                ref={scIframeRef}
                title={track.title}
                src={buildSoundCloudEmbedUrl(track.url)}
                allow="autoplay"
                className="h-72 w-full border-0"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 p-6">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Headphones className="h-9 w-9" />
                </div>
                <audio
                  ref={directAudioRef}
                  src={resolvedAudioSrc}
                  controls
                  preload="metadata"
                  onLoadedMetadata={syncDirectAudioPosition}
                  onTimeUpdate={syncDirectAudioPosition}
                  onPlay={() => {
                    getAudioEngine().unlock({
                      bells: [closingBellSoundRef.current],
                    });
                    markPlayingStart();
                    syncDirectAudioPosition();
                    setEarlyStopElapsedSec(null);
                    setPlaybackState("playing");
                  }}
                  onPause={() => {
                    flushListeningMs();
                    setPlaybackState((prev) =>
                      prev === "completed" ? prev : "paused"
                    );
                  }}
                  onEnded={() => handleTrackCompleted()}
                  onError={() =>
                    setPlayerErrorKey(
                      track.provider === "GOOGLE_DRIVE"
                        ? "google_drive"
                        : "direct_audio"
                    )
                  }
                  className="w-full"
                />

                <div className="flex flex-col items-center gap-1.5">
                  {offlineBlobUrl && !isOnline ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-medium text-[var(--accent)]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {m.guided.player.playingOffline}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleToggleOfflineSave()}
                      disabled={isTogglingOffline || (!isOnline && !isSavedOffline)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-[var(--background)] px-3 py-1 text-[11px] font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50 dark:border-white/10"
                    >
                      {isTogglingOffline ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
                          {m.guided.downloadingOffline}
                        </>
                      ) : isSavedOffline && offlineMeta ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                          <span className="text-[var(--accent)]">
                            {m.guided.player.savedOffline} ·{" "}
                            {formatBytesLabel(offlineMeta.bytes)}
                          </span>
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5" />
                          {m.guided.player.saveOffline}
                        </>
                      )}
                    </button>
                  )}

                  {offlineError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      {offlineError}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Early-Stop Save Prompt */}
          {earlyStopElapsedSec !== null ? (
            <EarlyFinishCard
              subtitle={m.guided.player.listenedFor(
                formatSessionDuration(earlyStopElapsedSec)
              )}
              noteValue={noteInput}
              isSaving={isSavingEarlyStop}
              onChangeNote={setNoteInput}
              onDiscard={onExit}
              onSave={() => void handleSaveEarlyStop()}
              onResume={() => setEarlyStopElapsedSec(null)}
            />
          ) : !playerError || isExternalMode ? (
            <p className="text-center text-xs text-[var(--foreground-muted)]">
              {isExternalMode
                ? m.guided.player.externalCompanionHint(providerName)
                : isStreamAudio
                  ? m.guided.player.lockScreenHint
                  : isWakeLockActive
                    ? m.guided.player.wakeLockHint
                    : m.guided.player.pressPlayHint}
            </p>
          ) : null}
        </div>
      )}

      {/* OLED-friendly Zen Dim Mode Overlay */}
      {isDimmed && playbackState !== "completed" && (
        <ZenDimOverlay
          primaryText={
            isExternalMode ? formatElapsedDisplay(externalElapsedMs) : track.title
          }
          monospace={isExternalMode}
          onWake={() => setIsDimmed(false)}
        />
      )}

      {/* Bottom Controls */}
      {playbackState !== "completed" && earlyStopElapsedSec === null && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-black/6 bg-[var(--surface)] px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => {
              getAudioEngine().unlock();
              onToggleClosingBell();
            }}
            className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--foreground)]"
          >
            {closingBellEnabled ? (
              <Bell className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            ) : (
              <BellOff className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
            )}
            <span className="truncate">
              {m.guided.player.bellLabel}:{" "}
              {closingBellEnabled
                ? closingBellStrikes === 3
                  ? `${closingBellName} · 3×`
                  : closingBellName
                : m.common.off}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setIsDimmed(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
            >
              <EyeOff className="h-3.5 w-3.5" />
              {m.guided.player.dim}
            </button>

            <a
              href={track.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
            >
              {m.guided.player.source}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
