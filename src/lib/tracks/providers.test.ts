import { describe, expect, it } from "vitest";
import {
  MAX_TRACK_TAGS,
  buildSoundCloudEmbedUrl,
  normalizeTrackTags,
  parseTrackUrl,
} from "./providers";

describe("track URL providers", () => {
  describe("YouTube", () => {
    it("parses standard watch URLs", () => {
      const result = parseTrackUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"
      );
      expect(result).toEqual({
        provider: "YOUTUBE",
        externalId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        defaultThumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        fallbackTitle: "YouTube Meditation",
      });
    });

    it("parses short youtu.be, shorts, embed, and music URLs", () => {
      expect(parseTrackUrl("https://youtu.be/abc123XYZ_-")?.externalId).toBe(
        "abc123XYZ_-"
      );
      expect(
        parseTrackUrl("https://youtube.com/shorts/abc123XYZ_-")?.externalId
      ).toBe("abc123XYZ_-");
      expect(
        parseTrackUrl("https://music.youtube.com/watch?v=abc123XYZ_-")
          ?.externalId
      ).toBe("abc123XYZ_-");
      expect(
        parseTrackUrl("https://www.youtube.com/embed/abc123XYZ_-")?.externalId
      ).toBe("abc123XYZ_-");
    });

    it("rejects malformed YouTube video IDs", () => {
      expect(parseTrackUrl("https://www.youtube.com/watch?v=short")).toBeNull();
      expect(parseTrackUrl("https://www.youtube.com/channel/UC123")).toBeNull();
    });
  });

  describe("SoundCloud", () => {
    it("parses and canonicalizes SoundCloud track URLs", () => {
      const result = parseTrackUrl(
        "https://m.soundcloud.com/calm-artist/morning-breath-session?si=xyz123"
      );
      expect(result).toEqual({
        provider: "SOUNDCLOUD",
        externalId: "calm-artist/morning-breath-session",
        canonicalUrl:
          "https://soundcloud.com/calm-artist/morning-breath-session",
        defaultThumbnailUrl: null,
        fallbackTitle: "Morning Breath Session",
      });
    });

    it("rejects SoundCloud playlists, profile pages, and reserved routes", () => {
      expect(
        parseTrackUrl("https://soundcloud.com/calm-artist/sets/sleep-playlist")
      ).toBeNull();
      expect(parseTrackUrl("https://soundcloud.com/calm-artist")).toBeNull();
      expect(parseTrackUrl("https://soundcloud.com/discover/sets")).toBeNull();
    });
  });

  describe("Direct Audio", () => {
    it("parses direct .mp3 and .m4a audio URLs with query strings", () => {
      const mp3 = parseTrackUrl(
        "https://cdn.example.com/audio/evening-body-scan.mp3?token=abc"
      );
      expect(mp3).toEqual({
        provider: "DIRECT_AUDIO",
        externalId: "cdn.example.com/audio/evening-body-scan.mp3",
        canonicalUrl:
          "https://cdn.example.com/audio/evening-body-scan.mp3?token=abc",
        defaultThumbnailUrl: null,
        fallbackTitle: "Evening Body Scan",
      });

      const m4a = parseTrackUrl("https://media.example.org/meditation_01.m4a");
      expect(m4a?.provider).toBe("DIRECT_AUDIO");
      expect(m4a?.fallbackTitle).toBe("Meditation 01");
    });

    it("rejects non-audio direct links", () => {
      expect(parseTrackUrl("https://example.com/page.html")).toBeNull();
      expect(parseTrackUrl("https://example.com/cover.png")).toBeNull();
    });
  });

  describe("normalizeTrackTags", () => {
    it("trims, deduplicates case-insensitively, and enforces max count", () => {
      expect(
        normalizeTrackTags([
          "  Morning  ",
          "morning",
          "Sleep",
          "",
          "Breath",
          "Focus",
          "Body Scan",
          "ExtraTag",
        ])
      ).toEqual(["Morning", "Sleep", "Breath", "Focus", "Body Scan"]);
      expect(
        normalizeTrackTags(["a", "b", "c", "d", "e", "f"])
      ).toHaveLength(MAX_TRACK_TAGS);
    });
  });

  describe("unsupported URLs", () => {
    it("rejects empty strings and unsupported domains", () => {
      expect(parseTrackUrl("")).toBeNull();
      expect(parseTrackUrl("https://open.spotify.com/track/123")).toBeNull();
      expect(parseTrackUrl("not a url")).toBeNull();
    });
  });

  describe("buildSoundCloudEmbedUrl", () => {
    it("builds a clean SoundCloud player embed URL", () => {
      const url = buildSoundCloudEmbedUrl(
        "https://soundcloud.com/calm-artist/morning-breath"
      );
      expect(url).toContain("https://w.soundcloud.com/player/?");
      expect(url).toContain(
        encodeURIComponent("https://soundcloud.com/calm-artist/morning-breath")
      );
      expect(url).toContain("auto_play=false");
    });
  });
});
