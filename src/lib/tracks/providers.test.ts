import { describe, expect, it } from "vitest";
import {
  MAX_TRACK_TAGS,
  buildGoogleDriveDownloadUrl,
  buildSoundCloudEmbedUrl,
  extractFilenameFromContentDisposition,
  isAudioStreamProvider,
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

    it("preserves private SoundCloud secret tokens (s-...) and strips non-secret trailing segments", () => {
      const privateTrack = parseTrackUrl(
        "https://soundcloud.com/calm-artist/private-guided-sit/s-AbCdEf12345?si=xyz"
      );
      expect(privateTrack).toEqual({
        provider: "SOUNDCLOUD",
        externalId: "calm-artist/private-guided-sit/s-AbCdEf12345",
        canonicalUrl:
          "https://soundcloud.com/calm-artist/private-guided-sit/s-AbCdEf12345",
        defaultThumbnailUrl: null,
        fallbackTitle: "Private Guided Sit",
      });

      const withTrailingSegment = parseTrackUrl(
        "https://soundcloud.com/calm-artist/morning-breath-session/recommended"
      );
      expect(withTrailingSegment?.canonicalUrl).toBe(
        "https://soundcloud.com/calm-artist/morning-breath-session"
      );
    });

    it("rejects SoundCloud playlists, profile pages, and reserved routes", () => {
      expect(
        parseTrackUrl("https://soundcloud.com/calm-artist/sets/sleep-playlist")
      ).toBeNull();
      expect(parseTrackUrl("https://soundcloud.com/calm-artist")).toBeNull();
      expect(parseTrackUrl("https://soundcloud.com/discover/sets")).toBeNull();
    });
  });

  describe("Google Drive", () => {
    const fileId = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";

    it("parses and canonicalizes standard /file/d/<id>/view share links", () => {
      const result = parseTrackUrl(
        `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
      );
      expect(result).toEqual({
        provider: "GOOGLE_DRIVE",
        externalId: fileId,
        canonicalUrl: `https://drive.google.com/file/d/${fileId}/view`,
        defaultThumbnailUrl: null,
        fallbackTitle: "Google Drive Audio",
      });
    });

    it("parses multi-account, workspace, open, uc, and usercontent download links", () => {
      expect(
        parseTrackUrl(`https://drive.google.com/u/0/file/d/${fileId}/preview`)
          ?.externalId
      ).toBe(fileId);
      expect(
        parseTrackUrl(
          `https://drive.google.com/a/example.org/file/d/${fileId}/edit`
        )?.externalId
      ).toBe(fileId);
      expect(
        parseTrackUrl(`https://drive.google.com/open?id=${fileId}`)?.externalId
      ).toBe(fileId);
      expect(
        parseTrackUrl(
          `https://drive.google.com/uc?id=${fileId}&export=download`
        )?.externalId
      ).toBe(fileId);
      expect(
        parseTrackUrl(
          `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
        )?.externalId
      ).toBe(fileId);
    });

    it("rejects Google Drive folders, Google Docs, and invalid file IDs", () => {
      expect(
        parseTrackUrl(`https://drive.google.com/drive/folders/${fileId}`)
      ).toBeNull();
      expect(
        parseTrackUrl(`https://drive.google.com/drive/u/0/folders/${fileId}`)
      ).toBeNull();
      expect(
        parseTrackUrl(`https://docs.google.com/document/d/${fileId}/edit`)
      ).toBeNull();
      expect(
        parseTrackUrl("https://drive.google.com/file/d/short/view")
      ).toBeNull();
    });

    it("builds the direct usercontent download URL with confirm=t", () => {
      expect(buildGoogleDriveDownloadUrl(fileId)).toBe(
        `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
      );
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

  describe("isAudioStreamProvider", () => {
    it("returns true for DIRECT_AUDIO and GOOGLE_DRIVE only", () => {
      expect(isAudioStreamProvider("DIRECT_AUDIO")).toBe(true);
      expect(isAudioStreamProvider("GOOGLE_DRIVE")).toBe(true);
      expect(isAudioStreamProvider("YOUTUBE")).toBe(false);
      expect(isAudioStreamProvider("SOUNDCLOUD")).toBe(false);
    });
  });

  describe("extractFilenameFromContentDisposition", () => {
    it("prefers RFC 5987 UTF-8 filename* and preserves accented titles", () => {
      expect(
        extractFilenameFromContentDisposition(
          `attachment; filename="fallback.mp3"; filename*=UTF-8''Medita%C3%A7%C3%A3o%20da%20Manh%C3%A3.mp3`
        )
      ).toBe("Meditação da Manhã");
    });

    it("extracts quoted and bare filenames and strips audio extensions", () => {
      expect(
        extractFilenameFromContentDisposition(
          'attachment; filename="Evening Body Scan.m4a"'
        )
      ).toBe("Evening Body Scan");
      expect(
        extractFilenameFromContentDisposition(
          "attachment; filename=calm_breath_session.opus"
        )
      ).toBe("calm breath session");
      expect(extractFilenameFromContentDisposition(null)).toBeNull();
      expect(extractFilenameFromContentDisposition("inline")).toBeNull();
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
