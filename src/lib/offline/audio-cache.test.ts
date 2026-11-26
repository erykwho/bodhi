import { afterEach, describe, expect, it, vi } from "vitest";
import type { FavoriteTrackItem, TrackPlaylistItem } from "@/lib/tracks/types";
import {
  OFFLINE_GUIDED_AUDIO_CACHE_NAME,
  OFFLINE_GUIDED_STORAGE_KEY,
  buildOfflineAudioCacheKey,
  cacheGuidedPlaylists,
  cacheGuidedTrackList,
  formatBytesLabel,
  getGuidedAutoAdvanceSnapshot,
  getOfflineGuidedSnapshot,
  getOfflineTrackAudioBlobUrl,
  removeTrackAudioOffline,
  saveTrackAudioOffline,
  setGuidedAutoAdvancePreference,
} from "./audio-cache";

const SAMPLE_TRACK: FavoriteTrackItem = {
  id: "track-direct-1",
  provider: "DIRECT_AUDIO",
  url: "https://cdn.example.com/meditation.mp3",
  externalId: "https://cdn.example.com/meditation.mp3",
  title: "Evening Body Scan",
  author: "Bodhi Audio",
  thumbnailUrl: null,
  tags: ["Sleep"],
  isFavorite: true,
  createdAt: "2026-11-22T00:00:00.000Z",
};

const SAMPLE_PLAYLIST: TrackPlaylistItem = {
  id: "playlist-1",
  name: "Evening Sequence",
  description: "Wind down before sleep",
  trackIds: ["track-direct-1"],
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

describe("offline guided audio cache", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
    URL.createObjectURL = originalCreateObjectURL;
  });

  it("formats byte sizes cleanly for KB and MB", () => {
    expect(formatBytesLabel(0)).toBe("0 KB");
    expect(formatBytesLabel(512)).toBe("1 KB");
    expect(formatBytesLabel(256 * 1024)).toBe("256 KB");
    expect(formatBytesLabel(4.2 * 1024 * 1024)).toBe("4.2 MB");
  });

  it("handles corrupt localStorage gracefully without throwing", () => {
    const store = new Map<string, string>([
      [OFFLINE_GUIDED_STORAGE_KEY, "{not valid json"],
    ]);
    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const snap = getOfflineGuidedSnapshot();
    expect(snap.tracks).toEqual([]);
    expect(snap.playlists).toEqual([]);
    expect(snap.savedAudio).toEqual({});
  });

  it("defaults missing isFavorite and playlists when reading legacy cached snapshots", () => {
    const store = new Map<string, string>([
      [
        OFFLINE_GUIDED_STORAGE_KEY,
        JSON.stringify({
          tracks: [
            {
              id: "legacy-track",
              provider: "DIRECT_AUDIO",
              url: "https://cdn.example.com/legacy.mp3",
              externalId: "https://cdn.example.com/legacy.mp3",
              title: "Legacy Track",
              author: null,
              thumbnailUrl: null,
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
          savedAudio: {},
        }),
      ],
    ]);
    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const snap = getOfflineGuidedSnapshot();
    expect(snap.tracks).toHaveLength(1);
    expect(snap.tracks[0].isFavorite).toBe(false);
    expect(snap.tracks[0].tags).toEqual([]);
    expect(snap.playlists).toEqual([]);
  });

  it("falls back to authenticated proxy when direct CORS fetch fails, stores in Cache Storage, preserves playlists, reads blob URL, and cleans up on remove", async () => {
    const lsStore = new Map<string, string>();
    const cacheBuckets = new Map<string, Map<string, Response>>();

    const fakeCaches = {
      open: vi.fn(async (name: string) => {
        let bucket = cacheBuckets.get(name);
        if (!bucket) {
          bucket = new Map();
          cacheBuckets.set(name, bucket);
        }
        return {
          put: vi.fn(async (key: string, res: Response) => {
            bucket!.set(key, res);
          }),
          match: vi.fn(async (key: string) => bucket!.get(key)),
          delete: vi.fn(async (key: string) => bucket!.delete(key)),
        };
      }),
    };

    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage: {
        getItem: (k: string) => lsStore.get(k) ?? null,
        setItem: (k: string, v: string) => lsStore.set(k, v),
      },
      caches: fakeCaches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    URL.createObjectURL = vi.fn(() => "blob:bodhi-offline-audio");

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const s = String(url);
      if (s.startsWith("https://cdn.example.com")) {
        throw new TypeError("Failed to fetch (CORS)");
      }
      if (s === `/api/tracks/${SAMPLE_TRACK.id}/audio`) {
        return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    cacheGuidedTrackList([SAMPLE_TRACK]);
    cacheGuidedPlaylists([SAMPLE_PLAYLIST]);
    const meta = await saveTrackAudioOffline(SAMPLE_TRACK, true);
    expect(meta.bytes).toBe(8);
    expect(fakeCaches.open).toHaveBeenCalledWith(OFFLINE_GUIDED_AUDIO_CACHE_NAME);

    const snap = getOfflineGuidedSnapshot();
    expect(snap.savedAudio[SAMPLE_TRACK.id]?.bytes).toBe(8);
    expect(snap.playlists).toEqual([SAMPLE_PLAYLIST]);

    const blobUrl = await getOfflineTrackAudioBlobUrl(SAMPLE_TRACK.id);
    expect(blobUrl).toBe("blob:bodhi-offline-audio");

    await removeTrackAudioOffline(SAMPLE_TRACK.id);
    expect(getOfflineGuidedSnapshot().savedAudio[SAMPLE_TRACK.id]).toBeUndefined();
    expect(getOfflineGuidedSnapshot().playlists).toEqual([SAMPLE_PLAYLIST]);
    expect(
      cacheBuckets
        .get(OFFLINE_GUIDED_AUDIO_CACHE_NAME)
        ?.has(buildOfflineAudioCacheKey(SAMPLE_TRACK.id))
    ).toBe(false);
  });

  it("persists guided playlist auto-advance preference with default false", () => {
    const lsStore = new Map<string, string>();
    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage: {
        getItem: (k: string) => lsStore.get(k) ?? null,
        setItem: (k: string, v: string) => lsStore.set(k, v),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    expect(getGuidedAutoAdvanceSnapshot()).toBe(false);
    setGuidedAutoAdvancePreference(true);
    expect(getGuidedAutoAdvanceSnapshot()).toBe(true);
    setGuidedAutoAdvancePreference(false);
    expect(getGuidedAutoAdvanceSnapshot()).toBe(false);
  });

  it("saves GOOGLE_DRIVE tracks offline directly via the authenticated audio proxy", async () => {
    const driveTrack: FavoriteTrackItem = {
      id: "track-drive-1",
      provider: "GOOGLE_DRIVE",
      url: "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345/view",
      externalId: "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
      title: "Morning Calm",
      author: "Google Drive",
      thumbnailUrl: null,
      tags: ["Morning"],
      isFavorite: false,
      createdAt: "2026-11-24T00:00:00.000Z",
    };

    const lsStore = new Map<string, string>();
    const cacheBuckets = new Map<string, Map<string, Response>>();

    const fakeCaches = {
      open: vi.fn(async (name: string) => {
        let bucket = cacheBuckets.get(name);
        if (!bucket) {
          bucket = new Map();
          cacheBuckets.set(name, bucket);
        }
        return {
          put: vi.fn(async (key: string, res: Response) => {
            bucket!.set(key, res);
          }),
          match: vi.fn(async (key: string) => bucket!.get(key)),
          delete: vi.fn(async (key: string) => bucket!.delete(key)),
        };
      }),
    };

    (globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage: {
        getItem: (k: string) => lsStore.get(k) ?? null,
        setItem: (k: string, v: string) => lsStore.set(k, v),
      },
      caches: fakeCaches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`/api/tracks/${driveTrack.id}/audio`);
      return new Response(new Uint8Array([9, 8, 7, 6]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const meta = await saveTrackAudioOffline(driveTrack, true);
    expect(meta.bytes).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOfflineGuidedSnapshot().savedAudio[driveTrack.id]?.bytes).toBe(4);
  });
});
