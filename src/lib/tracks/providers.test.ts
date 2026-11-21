import { describe, expect, it } from "vitest";
import { buildSoundCloudEmbedUrl, parseTrackUrl } from "./providers";

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
