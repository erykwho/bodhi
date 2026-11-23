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
  ExternalLink,
  EyeOff,
  Headphones,
  Loader2,
  RotateCcw,
  Square,
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
  getTimerPreferencesServerSnapshot,
  getTimerPreferencesSnapshot,
  subscribeTimerPreferences,
} from "@/lib/timer/preferences";
import type { BellStrikeCount } from "@/lib/timer/types";
import { buildSoundCloudEmbedUrl } from "@/lib/tracks/providers";
import type { FavoriteTrackItem } from "@/lib/tracks/types";
import { useWakeLock } from "@/lib/wake-lock";

type PlaybackState = "loading" | "ready" | "playing" | "paused" | "completed";

interface YouTubePlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
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
  onToggleClosingBell: () => void;
  onExit: () => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
}

export function GuidedSessionPlayer({
  track,
  closingBellEnabled,
  isAuthenticated = false,
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

  // Sync the closing bell sound, strikes, and volume with the user's Timer settings
  const closingBellSoundId: BellSoundId =
    timerPrefs.endBell === "none" ? DEFAULT_END_BELL_ID : timerPrefs.endBell;
  const closingBellStrikes: BellStrikeCount = timerPrefs.endBellStrikes;
  const closingBellVolume: number = timerPrefs.bellVolume;
  const closingBellName = m.sounds.bells[closingBellSoundId];

  const [playbackState, setPlaybackState] = useState<PlaybackState>(
    track.provider === "DIRECT_AUDIO" ? "ready" : "loading"
  );
  const [playerErrorKey, setPlayerErrorKey] = useState<
    "youtube" | "soundcloud" | "direct_audio" | null
  >(null);
  const [isDimmed, setIsDimmed] = useState<boolean>(false);

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
    playbackState === "playing" && track.provider !== "DIRECT_AUDIO"
  );

  const handleTrackCompleted = useCallback(() => {
    const elapsedSec = Math.max(1, Math.round(flushListeningMs() / 1000));
    setCompletedDurationSec(elapsedSec);
    setIsDimmed(false);
    setPlaybackState("completed");

    if (closingBellRef.current) {
      const audio = getAudioEngine();
      audio.unlock();
      audio.playBellStrikes(
        closingBellSoundRef.current,
        closingBellStrikesRef.current,
        closingBellVolumeRef.current
      );
    }

    if (isAuthenticated) {
      void saveMeditationSession({
        mode: "TRACK",
        trackId: track.id,
        trackTitle: track.title,
        trackProvider: track.provider,
        actualDurationSec: elapsedSec,
        completed: true,
        startedAt: sessionStartedAtRef.current ?? undefined,
        endedAt: new Date().toISOString(),
      }).then((saved) => {
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
  ]);

  // Configure Media Session API for lock-screen controls on Direct Audio tracks
  useEffect(() => {
    if (track.provider !== "DIRECT_AUDIO") return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    try {
      mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.author ?? "Bodhi Guided Practice",
        album: "Bodhi",
        artwork: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });

      mediaSession.setActionHandler("play", () => {
        void directAudioRef.current?.play();
      });
      mediaSession.setActionHandler("pause", () => {
        directAudioRef.current?.pause();
      });
      mediaSession.setActionHandler("seekbackward", (details) => {
        const el = directAudioRef.current;
        if (!el) return;
        const offset = details.seekOffset ?? 15;
        el.currentTime = Math.max(0, el.currentTime - offset);
      });
      mediaSession.setActionHandler("seekforward", (details) => {
        const el = directAudioRef.current;
        if (!el) return;
        const offset = details.seekOffset ?? 15;
        const max = Number.isFinite(el.duration)
          ? el.duration
          : el.currentTime + offset;
        el.currentTime = Math.min(max, el.currentTime + offset);
      });
      mediaSession.setActionHandler("stop", () => {
        const el = directAudioRef.current;
        if (!el) return;
        el.pause();
        el.currentTime = 0;
      });
    } catch {
      // Ignore unsupported Media Session handlers on older browsers
    }

    return () => {
      try {
        mediaSession.metadata = null;
        mediaSession.setActionHandler("play", null);
        mediaSession.setActionHandler("pause", null);
        mediaSession.setActionHandler("seekbackward", null);
        mediaSession.setActionHandler("seekforward", null);
        mediaSession.setActionHandler("stop", null);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [track.author, track.provider, track.title]);

  // Sync Media Session playbackState
  useEffect(() => {
    if (track.provider !== "DIRECT_AUDIO") return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState =
      playbackState === "playing"
        ? "playing"
        : playbackState === "paused"
          ? "paused"
          : "none";
  }, [playbackState, track.provider]);

  // Mount YouTube IFrame Player API into an unmanaged child node so YouTube's
  // in-place iframe replacement never conflicts with React's unmount reconciliation.
  useEffect(() => {
    if (track.provider !== "YOUTUBE") return;
    let cancelled = false;
    const host = ytHostRef.current;

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host) return;

        host.innerHTML = "";
        const mountNode = document.createElement("div");
        mountNode.className = "h-full w-full";
        host.appendChild(mountNode);

        ytPlayerRef.current = new YT.Player(mountNode, {
          videoId: track.externalId,
          width: "100%",
          height: "100%",
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (!cancelled) {
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
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerErrorKey("youtube");
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
  ]);

  // Mount SoundCloud Widget API
  useEffect(() => {
    if (track.provider !== "SOUNDCLOUD") return;
    let cancelled = false;

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
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerErrorKey("soundcloud");
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
        } catch {
          // Ignore teardown errors if the iframe is already detached
        }
      }
      scWidgetRef.current = null;
    };
  }, [
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
      const elapsedSec = Math.floor(flushListeningMs() / 1000);
      if (elapsedSec >= MIN_SAVEABLE_EARLY_STOP_SECONDS) {
        pauseActivePlayer();
        setPlaybackState("paused");
        setEarlyStopElapsedSec(elapsedSec);
        return;
      }
    }
    onExit();
  }, [
    flushListeningMs,
    isAuthenticated,
    onExit,
    pauseActivePlayer,
    playbackState,
  ]);

  const handleSaveEarlyStop = useCallback(async () => {
    if (earlyStopElapsedSec === null) return;
    setIsSavingEarlyStop(true);
    const saved = await saveMeditationSession({
      mode: "TRACK",
      trackId: track.id,
      trackTitle: track.title,
      trackProvider: track.provider,
      actualDurationSec: earlyStopElapsedSec,
      completed: false,
      note: noteInput.trim() || null,
      startedAt: sessionStartedAtRef.current ?? undefined,
      endedAt: new Date().toISOString(),
    });
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
  ]);

  const handleSaveCompletedNote = useCallback(async () => {
    if (!savedSessionId) return;
    setIsSavingNote(true);
    const updated = await updateMeditationSessionNote(
      savedSessionId,
      noteInput.trim() || null
    );
    setIsSavingNote(false);
    if (updated) {
      setNoteSaved(true);
      onSessionUpdated?.(updated);
    }
  }, [noteInput, onSessionUpdated, savedSessionId]);

  const handleReplay = useCallback(() => {
    getAudioEngine().unlock();
    accumulatedListenMsRef.current = 0;
    playSegmentStartRef.current = null;
    sessionStartedAtRef.current = null;
    setSavedSessionId(null);
    setNoteInput("");
    setNoteSaved(false);
    setEarlyStopElapsedSec(null);
    setPlaybackState("playing");

    if (track.provider === "YOUTUBE" && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(0, true);
      ytPlayerRef.current.playVideo();
    } else if (track.provider === "SOUNDCLOUD" && scWidgetRef.current) {
      scWidgetRef.current.seekTo(0);
      scWidgetRef.current.play();
    } else if (track.provider === "DIRECT_AUDIO" && directAudioRef.current) {
      directAudioRef.current.currentTime = 0;
      void directAudioRef.current.play();
    }
  }, [getAudioEngine, track.provider]);

  const statusLabel =
    playbackState === "playing"
      ? m.guided.player.listening
      : playbackState === "paused"
        ? m.guided.player.paused
        : playbackState === "completed"
          ? m.guided.player.completed
          : playbackState === "loading"
            ? m.guided.player.loading
            : m.guided.player.ready;

  const playerError =
    playerErrorKey === "youtube"
      ? m.guided.player.ytLoadError
      : playerErrorKey === "soundcloud"
        ? m.guided.player.scLoadError
        : playerErrorKey === "direct_audio"
          ? m.guided.player.directAudioError
          : null;

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
              {m.guided.player.favorites}
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
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

          {/* Embedded Provider Player (YouTube / SoundCloud / Direct Audio HTML5) */}
          <div className="overflow-hidden rounded-2xl border border-black/8 bg-[var(--surface)] shadow-xs dark:border-white/10">
            {playerError ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-sm text-[var(--foreground-muted)]">
                  {playerError}
                </p>
                <a
                  href={track.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[#fcfaf6] dark:text-[#151917]"
                >
                  {m.guided.player.openOriginal}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : track.provider === "YOUTUBE" ? (
              <div className="relative aspect-video w-full bg-black">
                <div ref={ytHostRef} className="h-full w-full" />
              </div>
            ) : track.provider === "SOUNDCLOUD" ? (
              <iframe
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
                  src={track.url}
                  controls
                  preload="metadata"
                  onPlay={() => {
                    getAudioEngine().unlock();
                    markPlayingStart();
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
                  onError={() => setPlayerErrorKey("direct_audio")}
                  className="w-full"
                />
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
          ) : (
            <p className="text-center text-xs text-[var(--foreground-muted)]">
              {track.provider === "DIRECT_AUDIO"
                ? m.guided.player.lockScreenHint
                : isWakeLockActive
                  ? m.guided.player.wakeLockHint
                  : m.guided.player.pressPlayHint}
            </p>
          )}
        </div>
      )}

      {/* OLED-friendly Zen Dim Mode Overlay */}
      {isDimmed && playbackState !== "completed" && (
        <ZenDimOverlay
          primaryText={track.title}
          monospace={false}
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
