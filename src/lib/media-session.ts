export interface BodhiMediaMetadata {
  title: string;
  artist?: string;
  album?: string;
}

export interface BodhiMediaSessionHandlers {
  onPlay?: (() => void) | null;
  onPause?: (() => void) | null;
  onStop?: (() => void) | null;
  onSeekBackward?: ((seekOffsetSec: number) => void) | null;
  onSeekForward?: ((seekOffsetSec: number) => void) | null;
  onPreviousTrack?: (() => void) | null;
  onNextTrack?: (() => void) | null;
}

export interface BodhiMediaPositionState {
  duration: number;
  position: number;
  playbackRate?: number;
}

const BODHI_ARTWORK: MediaImage[] = [
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
];

function getMediaSession(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }
  return navigator.mediaSession ?? null;
}

export function setMediaSessionMetadata(meta: BodhiMediaMetadata): void {
  const mediaSession = getMediaSession();
  if (!mediaSession || typeof MediaMetadata === "undefined") return;

  try {
    mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist ?? "Bodhi",
      album: meta.album ?? "Bodhi",
      artwork: BODHI_ARTWORK,
    });
  } catch {
    // Ignore unsupported MediaMetadata environments
  }
}

export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState
): void {
  const mediaSession = getMediaSession();
  if (!mediaSession) return;

  try {
    mediaSession.playbackState = state;
  } catch {
    // Ignore read-only or unsupported playbackState
  }
}

export function setMediaSessionPositionState(
  state: BodhiMediaPositionState | null
): void {
  const mediaSession = getMediaSession();
  if (!mediaSession || typeof mediaSession.setPositionState !== "function") {
    return;
  }

  try {
    if (!state) {
      mediaSession.setPositionState();
      return;
    }

    if (
      !Number.isFinite(state.duration) ||
      state.duration <= 0 ||
      !Number.isFinite(state.position)
    ) {
      return;
    }

    const clampedPosition = Math.min(
      state.duration,
      Math.max(0, state.position)
    );
    const playbackRate =
      state.playbackRate !== undefined &&
      Number.isFinite(state.playbackRate) &&
      state.playbackRate > 0
        ? state.playbackRate
        : 1;

    mediaSession.setPositionState({
      duration: state.duration,
      position: clampedPosition,
      playbackRate,
    });
  } catch {
    // Ignore browser-specific setPositionState validation quirks
  }
}

export function setMediaSessionActionHandlers(
  handlers: BodhiMediaSessionHandlers
): void {
  const mediaSession = getMediaSession();
  if (!mediaSession || typeof mediaSession.setActionHandler !== "function") {
    return;
  }

  const safeSet = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null
  ) => {
    try {
      mediaSession.setActionHandler(action, handler);
    } catch {
      // Ignore unsupported actions on older browsers
    }
  };

  safeSet("play", handlers.onPlay ? () => handlers.onPlay?.() : null);
  safeSet("pause", handlers.onPause ? () => handlers.onPause?.() : null);
  safeSet("stop", handlers.onStop ? () => handlers.onStop?.() : null);
  safeSet(
    "seekbackward",
    handlers.onSeekBackward
      ? (details) => handlers.onSeekBackward?.(details.seekOffset ?? 15)
      : null
  );
  safeSet(
    "seekforward",
    handlers.onSeekForward
      ? (details) => handlers.onSeekForward?.(details.seekOffset ?? 15)
      : null
  );
  safeSet(
    "previoustrack",
    handlers.onPreviousTrack ? () => handlers.onPreviousTrack?.() : null
  );
  safeSet(
    "nexttrack",
    handlers.onNextTrack ? () => handlers.onNextTrack?.() : null
  );
}

export function clearMediaSession(): void {
  const mediaSession = getMediaSession();
  if (!mediaSession) return;

  try {
    mediaSession.metadata = null;
  } catch {
    // Ignore
  }
  setMediaSessionPlaybackState("none");
  setMediaSessionPositionState(null);
  setMediaSessionActionHandlers({});
}
