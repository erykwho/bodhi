"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ExternalLink,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import { MeditationAudioEngine } from "@/lib/audio/engine";
import {
  saveMeditationSession,
  updateMeditationSessionNote,
} from "@/lib/history/client";
import {
  MIN_SAVEABLE_EARLY_STOP_SECONDS,
  formatSessionDuration,
} from "@/lib/history/stats";
import type { MeditationSessionItem } from "@/lib/history/types";
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
  const [playbackState, setPlaybackState] = useState<PlaybackState>("loading");
  const [playerError, setPlayerError] = useState<string | null>(null);

  // V3 History logging state
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
  const audioRef = useRef<MeditationAudioEngine | null>(null);
  const closingBellRef = useRef(closingBellEnabled);

  // Accurate active-listening duration tracking (excludes paused intervals)
  const sessionStartedAtRef = useRef<string | null>(null);
  const playSegmentStartRef = useRef<number | null>(null);
  const accumulatedListenMsRef = useRef<number>(0);

  useEffect(() => {
    closingBellRef.current = closingBellEnabled;
  }, [closingBellEnabled]);

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
    playbackState === "playing"
  );

  const handleTrackCompleted = useCallback(() => {
    const elapsedSec = Math.max(1, Math.round(flushListeningMs() / 1000));
    setCompletedDurationSec(elapsedSec);
    setPlaybackState("completed");

    if (closingBellRef.current) {
      const audio = getAudioEngine();
      audio.unlock();
      audio.playBell("end");
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
          setPlayerError(
            "Unable to load the YouTube player. Check your connection or open the track directly."
          );
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
          setPlayerError(
            "Unable to load the SoundCloud player. Check your connection or open the track directly."
          );
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
      } else {
        scWidgetRef.current?.pause();
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
    }
  }, [getAudioEngine, track.provider]);

  const statusLabel =
    playbackState === "playing"
      ? "Listening"
      : playbackState === "paused"
        ? "Paused"
        : playbackState === "completed"
          ? "Completed"
          : playbackState === "loading"
            ? "Loading player..."
            : "Ready";

  return (
    <div className="flex flex-1 flex-col justify-between gap-5 py-2">
      {/* Top Session Bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleExitClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Favorites
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
              Session Complete
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
                Saved to history
              </p>
            )}
          </div>

          {savedSessionId && (
            <div className="w-full rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 text-left dark:border-white/10">
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Add an optional reflection note..."
                value={noteInput}
                onChange={(event) => {
                  setNoteInput(event.target.value);
                  setNoteSaved(false);
                }}
                className="w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-[var(--foreground-muted)]">
                  {noteSaved ? "Note saved" : "Optional note"}
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
                  Save note
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
              Back to list
            </button>
            <button
              type="button"
              onClick={handleReplay}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
            >
              <RotateCcw className="h-4 w-4" />
              Replay
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-4">
          {/* Track Heading */}
          <div className="text-center">
            <span className="inline-block rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--foreground-muted)]">
              {track.provider === "YOUTUBE" ? "YouTube" : "SoundCloud"}
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

          {/* Embedded Provider Player (kept visible for YouTube Terms compliance) */}
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
                  Open original track
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : track.provider === "YOUTUBE" ? (
              <div className="relative aspect-video w-full bg-black">
                <div ref={ytHostRef} className="h-full w-full" />
              </div>
            ) : (
              <iframe
                ref={scIframeRef}
                title={track.title}
                src={buildSoundCloudEmbedUrl(track.url)}
                allow="autoplay"
                className="h-72 w-full border-0"
              />
            )}
          </div>

          {/* Early-Stop Save Prompt */}
          {earlyStopElapsedSec !== null ? (
            <div className="w-full rounded-2xl border border-black/8 bg-[var(--surface)] p-4 text-left shadow-xs dark:border-white/10">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Save partial session?
              </p>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                You listened for {formatSessionDuration(earlyStopElapsedSec)}.
              </p>
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Optional reflection note..."
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                className="mt-2.5 w-full resize-none rounded-xl border border-black/10 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onExit}
                  disabled={isSavingEarlyStop}
                  className="flex h-10 items-center justify-center rounded-xl border border-black/8 bg-[var(--background)] text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEarlyStop()}
                  disabled={isSavingEarlyStop}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
                >
                  {isSavingEarlyStop ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save Session
                </button>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-[var(--foreground-muted)]">
              {isWakeLockActive
                ? "Screen awake — plays full track from start to finish."
                : "Press play in the player above to begin your full-track session."}
            </p>
          )}
        </div>
      )}

      {/* Bottom Controls */}
      {playbackState !== "completed" && earlyStopElapsedSec === null && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => {
              getAudioEngine().unlock();
              onToggleClosingBell();
            }}
            className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]"
          >
            {closingBellEnabled ? (
              <Bell className="h-4 w-4 text-[var(--accent)]" />
            ) : (
              <BellOff className="h-4 w-4 text-[var(--foreground-muted)]" />
            )}
            <span>Closing bell: {closingBellEnabled ? "On" : "Off"}</span>
          </button>

          <a
            href={track.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Source
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
