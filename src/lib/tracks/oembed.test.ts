import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTrackMetadata } from "./oembed";

describe("resolveTrackMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves Google Drive UTF-8 filename from Content-Disposition with Range bytes=0-0", async () => {
    const fileId = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new Uint8Array([0]), {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition":
            "attachment; filename=\"fallback.mp3\"; filename*=UTF-8''Medita%C3%A7%C3%A3o%20Guiada.mp3",
        },
      })
    );

    const metadata = await resolveTrackMetadata(
      `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
      expect.objectContaining({
        method: "GET",
        redirect: "follow",
        headers: expect.objectContaining({ Range: "bytes=0-0" }),
      })
    );
    expect(metadata).toEqual({
      provider: "GOOGLE_DRIVE",
      url: `https://drive.google.com/file/d/${fileId}/view`,
      externalId: fileId,
      title: "Meditação Guiada",
      author: "Google Drive",
      thumbnailUrl: null,
    });
  });

  it("falls back to default Google Drive title when metadata request fails", async () => {
    const fileId = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));

    const metadata = await resolveTrackMetadata(
      `https://drive.google.com/open?id=${fileId}`
    );

    expect(metadata).toEqual({
      provider: "GOOGLE_DRIVE",
      url: `https://drive.google.com/file/d/${fileId}/view`,
      externalId: fileId,
      title: "Google Drive Audio",
      author: "Google Drive",
      thumbnailUrl: null,
    });
  });
});
