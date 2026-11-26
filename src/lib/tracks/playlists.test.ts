import { describe, expect, it } from "vitest";
import {
  MAX_TRACKS_PER_PLAYLIST,
  filterOfflinePlayablePlaylistTracks,
  getEligibleOfflineDownloadTracks,
  getPlaylistCoverThumbnail,
  mergePlaylistTrackAdditions,
  parseCachedPlaylists,
  parseGuidedAutoAdvancePreference,
  parsePlaylistUrl,
  removeTrackFromPlaylists,
  resolvePlaylistTracks,
} from "./playlists";
import type { FavoriteTrackItem, TrackPlaylistItem } from "./types";

const TRACKS: FavoriteTrackItem[] = [
  {
    id: "t1",
    provider: "YOUTUBE",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    externalId: "dQw4w9WgXcQ",
    title: "Morning Breath",
    author: "Teacher A",
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    tags: ["Morning"],
    isFavorite: true,
    createdAt: "2026-11-01T00:00:00.000Z",
  },
  {
    id: "t2",
    provider: "DIRECT_AUDIO",
    url: "https://cdn.example.com/body-scan.mp3",
    externalId: "cdn.example.com/body-scan.mp3",
    title: "Body Scan",
    author: "Bodhi",
    thumbnailUrl: null,
    tags: [],
    isFavorite: false,
    createdAt: "2026-11-02T00:00:00.000Z",
  },
  {
    id: "t3",
    provider: "GOOGLE_DRIVE",
    url: "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345/view",
    externalId: "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
    title: "Evening Wind Down",
    author: "Google Drive",
    thumbnailUrl: null,
    tags: ["Sleep"],
    isFavorite: false,
    createdAt: "2026-11-03T00:00:00.000Z",
  },
];

describe("playlist URL parsing and domain helpers", () => {
  it("parses direct YouTube playlist URLs and music.youtube.com playlists", () => {
    const standard = parsePlaylistUrl(
      "https://www.youtube.com/playlist?list=PL1234567890abcdef"
    );
    expect(standard).toEqual({
      provider: "YOUTUBE",
      externalId: "PL1234567890abcdef",
      canonicalUrl: "https://www.youtube.com/playlist?list=PL1234567890abcdef",
      isDirectPlaylistUrl: true,
    });

    const music = parsePlaylistUrl(
      "music.youtube.com/playlist?list=OLAK5uy_abcdefghij12345"
    );
    expect(music?.provider).toBe("YOUTUBE");
    expect(music?.isDirectPlaylistUrl).toBe(true);
  });

  it("detects persistent playlist IDs attached to YouTube watch URLs as indirect playlists", () => {
    const watchWithList = parsePlaylistUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abcdef&index=2"
    );
    expect(watchWithList).toEqual({
      provider: "YOUTUBE",
      externalId: "PL1234567890abcdef",
      canonicalUrl: "https://www.youtube.com/playlist?list=PL1234567890abcdef",
      isDirectPlaylistUrl: false,
    });
  });

  it("ignores ephemeral YouTube radio mixes (RD...) and private account lists (WL/LL)", () => {
    expect(
      parsePlaylistUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"
      )
    ).toBeNull();
    expect(
      parsePlaylistUrl("https://www.youtube.com/playlist?list=WL")
    ).toBeNull();
    expect(
      parsePlaylistUrl("https://www.youtube.com/playlist?list=LL")
    ).toBeNull();
  });

  it("parses public and secret-token SoundCloud set URLs", () => {
    const pub = parsePlaylistUrl(
      "https://soundcloud.com/calm-artist/sets/21-day-mindfulness?si=xyz"
    );
    expect(pub).toEqual({
      provider: "SOUNDCLOUD",
      externalId: "calm-artist/sets/21-day-mindfulness",
      canonicalUrl:
        "https://soundcloud.com/calm-artist/sets/21-day-mindfulness",
      isDirectPlaylistUrl: true,
    });

    const secret = parsePlaylistUrl(
      "https://soundcloud.com/calm-artist/sets/retreat/s-AbCdEf12345"
    );
    expect(secret).toEqual({
      provider: "SOUNDCLOUD",
      externalId: "calm-artist/sets/retreat/s-AbCdEf12345",
      canonicalUrl:
        "https://soundcloud.com/calm-artist/sets/retreat/s-AbCdEf12345",
      isDirectPlaylistUrl: true,
    });

    // Reject single SoundCloud track or reserved routes
    expect(
      parsePlaylistUrl("https://soundcloud.com/calm-artist/single-track")
    ).toBeNull();
    expect(
      parsePlaylistUrl("https://soundcloud.com/discover/sets/charts")
    ).toBeNull();
  });

  it("resolves playlist tracks in strict playlist sequence (independent of favorites)", () => {
    const resolved = resolvePlaylistTracks(
      { trackIds: ["t3", "missing-id", "t1", "t2", "t3"] },
      TRACKS
    );
    expect(resolved.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
    expect(
      getPlaylistCoverThumbnail({ trackIds: ["t3", "t1"] }, TRACKS)
    ).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("computes offline-playable tracks and eligible un-downloaded tracks accurately", () => {
    const playlist = { trackIds: ["t1", "t2", "t3"] };
    const saved = { t2: { bytes: 1024 } };

    const offline = filterOfflinePlayablePlaylistTracks(playlist, TRACKS, saved);
    expect(offline.map((t) => t.id)).toEqual(["t2"]);

    const eligible = getEligibleOfflineDownloadTracks(playlist, TRACKS, saved);
    expect(eligible.map((t) => t.id)).toEqual(["t3"]);
  });

  it("deduplicates and enforces the 100-track cap when adding tracks to a playlist", () => {
    const existing = Array.from({ length: MAX_TRACKS_PER_PLAYLIST - 1 }, (_, i) => `e-${i}`);
    const result = mergePlaylistTrackAdditions(existing, [
      "e-0",
      "new-1",
      "new-2",
      "new-1",
    ]);
    expect(result.addedTrackIds).toEqual(["new-1"]);
    expect(result.skippedDuplicateCount).toBe(2);
    expect(result.skippedCapCount).toBe(1);
    expect(result.nextTrackIds).toHaveLength(MAX_TRACKS_PER_PLAYLIST);
  });

  it("prunes deleted library tracks from cached playlists", () => {
    const playlists: TrackPlaylistItem[] = [
      {
        id: "p1",
        name: "Morning",
        description: null,
        trackIds: ["t1", "t2"],
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ];
    const next = removeTrackFromPlaylists(playlists, "t1");
    expect(next[0].trackIds).toEqual(["t2"]);
  });

  it("parses auto-advance preference safely (defaults to false) and parses legacy playlists safely", () => {
    expect(parseGuidedAutoAdvancePreference(null)).toBe(false);
    expect(parseGuidedAutoAdvancePreference(undefined)).toBe(false);
    expect(parseGuidedAutoAdvancePreference("false")).toBe(false);
    expect(parseGuidedAutoAdvancePreference("true")).toBe(true);
    expect(parseGuidedAutoAdvancePreference(true)).toBe(true);

    expect(parseCachedPlaylists(null)).toEqual([]);
    expect(parseCachedPlaylists("corrupt")).toEqual([]);
    const parsed = parseCachedPlaylists([
      { id: "p1", name: "Course", trackIds: ["t1", "t1", "", 123] },
      { invalid: true },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trackIds).toEqual(["t1"]);
    expect(parsed[0].description).toBeNull();
  });
});
