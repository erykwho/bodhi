import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMediaSession,
  setMediaSessionActionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "./media-session";

describe("media-session utility", () => {
  const originalNavigator = globalThis.navigator;
  const originalMediaMetadata = globalThis.MediaMetadata;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNavigator !== undefined) {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
    if (originalMediaMetadata === undefined) {
      delete (globalThis as { MediaMetadata?: typeof MediaMetadata })
        .MediaMetadata;
    } else {
      globalThis.MediaMetadata = originalMediaMetadata;
    }
  });

  it("publishes metadata, playbackState, clamped positionState, and action handlers safely", () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    const mediaSession = {
      metadata: null as unknown,
      playbackState: "none" as MediaSessionPlaybackState,
      setPositionState: vi.fn(),
      setActionHandler: vi.fn(
        (action: string, cb: MediaSessionActionHandler | null) => {
          handlers.set(action, cb);
        }
      ),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: { mediaSession },
      configurable: true,
      writable: true,
    });

    class FakeMediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: MediaImage[];
      constructor(init: MediaMetadataInit) {
        this.title = init.title ?? "";
        this.artist = init.artist ?? "";
        this.album = init.album ?? "";
        this.artwork = [...(init.artwork ?? [])];
      }
    }
    globalThis.MediaMetadata =
      FakeMediaMetadata as unknown as typeof MediaMetadata;

    setMediaSessionMetadata({ title: "Meditation · 10 min" });
    expect((mediaSession.metadata as FakeMediaMetadata).title).toBe(
      "Meditation · 10 min"
    );
    expect((mediaSession.metadata as FakeMediaMetadata).artwork).toHaveLength(
      2
    );

    setMediaSessionPlaybackState("playing");
    expect(mediaSession.playbackState).toBe("playing");

    // Position exceeding duration is clamped safely
    setMediaSessionPositionState({ duration: 600, position: 650 });
    expect(mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 600,
      position: 600,
      playbackRate: 1,
    });

    // Invalid duration is ignored safely
    mediaSession.setPositionState.mockClear();
    setMediaSessionPositionState({ duration: 0, position: 5 });
    expect(mediaSession.setPositionState).not.toHaveBeenCalled();

    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onStop = vi.fn();
    setMediaSessionActionHandlers({ onPlay, onPause, onStop });
    handlers.get("play")?.({ action: "play" });
    handlers.get("pause")?.({ action: "pause" });
    handlers.get("stop")?.({ action: "stop" });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);

    clearMediaSession();
    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe("none");
    expect(handlers.get("play")).toBeNull();
    expect(handlers.get("pause")).toBeNull();
  });
});
