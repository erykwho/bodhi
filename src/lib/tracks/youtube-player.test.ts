import { describe, expect, it } from "vitest";
import {
  buildYouTubePlayerVars,
  classifyYouTubePlayerError,
  isRetryableYouTubeError,
  supportsExternalYouTubeCompanion,
} from "@/lib/tracks/youtube-player";

describe("youtube-player utilities", () => {
  it("classifies official YouTube IFrame API error codes accurately", () => {
    expect(classifyYouTubePlayerError(101)).toBe("embed_disabled");
    expect(classifyYouTubePlayerError(150)).toBe("embed_disabled");
    expect(classifyYouTubePlayerError(100)).toBe("video_unavailable");
    expect(classifyYouTubePlayerError(153)).toBe("config_error");
    expect(classifyYouTubePlayerError(2)).toBe("playback_error");
    expect(classifyYouTubePlayerError(5)).toBe("playback_error");
    expect(classifyYouTubePlayerError(999)).toBe("playback_error");
  });

  it("identifies retryable errors and External Companion eligibility", () => {
    expect(isRetryableYouTubeError("embed_disabled")).toBe(false);
    expect(isRetryableYouTubeError("video_unavailable")).toBe(false);
    expect(isRetryableYouTubeError("config_error")).toBe(true);
    expect(isRetryableYouTubeError("playback_error")).toBe(true);

    expect(supportsExternalYouTubeCompanion("embed_disabled")).toBe(true);
    expect(supportsExternalYouTubeCompanion("config_error")).toBe(true);
    expect(supportsExternalYouTubeCompanion("playback_error")).toBe(true);
    expect(supportsExternalYouTubeCompanion("video_unavailable")).toBe(false);
  });

  it("includes validated HTTP(S) origin and enablejsapi in playerVars", () => {
    expect(buildYouTubePlayerVars("https://bodhi.app")).toEqual({
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: "https://bodhi.app",
    });

    expect(buildYouTubePlayerVars("http://localhost:3000/some/path")).toEqual({
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: "http://localhost:3000",
    });
  });

  it("omits origin when missing, non-HTTP(S), or malformed", () => {
    const base = {
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
    };

    expect(buildYouTubePlayerVars(undefined)).toEqual(base);
    expect(buildYouTubePlayerVars(null)).toEqual(base);
    expect(buildYouTubePlayerVars("null")).toEqual(base);
    expect(buildYouTubePlayerVars("file:///index.html")).toEqual(base);
    expect(buildYouTubePlayerVars("javascript:alert(1)")).toEqual(base);
  });
});
