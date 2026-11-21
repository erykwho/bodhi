"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import { MeditationAudioEngine } from "@/lib/audio/engine";
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
  onToggleClosingBell: () => void;
  onExit: () => void;
}

export function GuidedSessionPlayer({
  track,
  closingBellEnabled,
  onToggleClosingBell,
  onExit,
}: GuidedSessionPlayerProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("loading");
  const [playerError, setPlayerError] = useState<string | null>(null);

  const playerDomId = useId().replace(/:/g, "");
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YouTubePlayerInstance | null>(null);
  const scIframeRef = useRef<HTMLIFrameElement | null>(null);
  const scWidgetRef = useRef<SoundCloudWidgetInstance | null>(null);
  const audioRef = useRef<MeditationAudioEngine | null>(null);
  const closingBellRef = useRef(closingBellEnabled);

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

  const { isActive: isWakeLockActive } = useWakeLock(
    playbackState === "playing"
  );

  const handleTrackCompleted = useCallback(() => {
    setPlaybackState("completed");
    if (closingBellRef.current) {
      const audio = getAudioEngine();
      audio.unlock();
      audio.playBell("end");
    }
  }, [getAudioEngine]);

  // Mount YouTube IFrame Player API
  useEffect(() => {
    if (track.provider !== "YOUTUBE") return;
    let cancelled = false;

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !ytContainerRef.current) return;

        ytPlayerRef.current = new YT.Player(ytContainerRef.current, {
          videoId: track.externalId,
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
                setPlaybackState("playing");
              } else if (event.data === YT.PlayerState.PAUSED) {
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
    };
  }, [getAudioEngine, handleTrackCompleted, track.externalId, track.provider]);

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
            setPlaybackState("playing");
          }
        });
        widget.bind(Events.PAUSE, () => {
          if (!cancelled) setPlaybackState("paused");
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
        const Events = window.SC.Widget.Events;
        widget.unbind(Events.READY);
        widget.unbind(Events.PLAY);
        widget.unbind(Events.PAUSE);
        widget.unbind(Events.FINISH);
      }
      scWidgetRef.current = null;
    };
  }, [getAudioEngine, handleTrackCompleted, track.provider, track.url]);

  const handleReplay = useCallback(() => {
    getAudioEngine().unlock();
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
          onClick={onExit}
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
            </p>
          </div>
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
                <div
                  id={playerDomId}
                  ref={ytContainerRef}
                  className="h-full w-full"
                />
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

          {/* Wake Lock & Playback Hint */}
          <p className="text-center text-xs text-[var(--foreground-muted)]">
            {isWakeLockActive
              ? "Screen awake — plays full track from start to finish."
              : "Press play in the player above to begin your full-track session."}
          </p>
        </div>
      )}

      {/* Bottom Controls */}
      {playbackState !== "completed" && (
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
            <span>
              Closing bell: {closingBellEnabled ? "On" : "Off"}
            </span>
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
