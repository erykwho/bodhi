import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, prismaMock, resolveTrackMetadataMock } = vi.hoisted(
  () => ({
    requireUserMock: vi.fn(),
    resolveTrackMetadataMock: vi.fn(),
    prismaMock: {
      favoriteTrack: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        aggregate: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  })
);

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock,
  authErrorResponse: (err: unknown) => {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return null;
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/tracks/oembed", () => ({
  resolveTrackMetadata: resolveTrackMetadataMock,
}));

import { GET, POST } from "@/app/api/tracks/route";
import { DELETE, PATCH } from "@/app/api/tracks/[id]/route";
import {
  GET as AUDIO_GET,
  isSafePublicAudioUrl,
} from "@/app/api/tracks/[id]/audio/route";
import { PATCH as REORDER_PATCH } from "@/app/api/tracks/reorder/route";
import { POST as RESOLVE_POST } from "@/app/api/tracks/resolve/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/tracks/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
  });

  describe("Authentication (401)", () => {
    beforeEach(() => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    });

    it("returns 401 for unauthenticated requests across all track routes", async () => {
      const getRes = await GET();
      expect(getRes.status).toBe(401);

      const postRes = await POST(
        jsonRequest("http://localhost/api/tracks", "POST", {
          url: "https://youtu.be/dQw4w9WgXcQ",
        })
      );
      expect(postRes.status).toBe(401);

      const patchRes = await PATCH(
        jsonRequest("http://localhost/api/tracks/t1", "PATCH", {
          title: "Updated",
        }),
        { params: Promise.resolve({ id: "t1" }) }
      );
      expect(patchRes.status).toBe(401);

      const deleteRes = await DELETE(
        new Request("http://localhost/api/tracks/t1", { method: "DELETE" }),
        { params: Promise.resolve({ id: "t1" }) }
      );
      expect(deleteRes.status).toBe(401);

      const reorderRes = await REORDER_PATCH(
        jsonRequest("http://localhost/api/tracks/reorder", "PATCH", {
          orderedIds: ["t1"],
        })
      );
      expect(reorderRes.status).toBe(401);

      const resolveRes = await RESOLVE_POST(
        jsonRequest("http://localhost/api/tracks/resolve", "POST", {
          url: "https://youtu.be/dQw4w9WgXcQ",
        })
      );
      expect(resolveRes.status).toBe(401);
    });
  });

  describe("GET & POST /api/tracks", () => {
    it("scopes GET queries strictly by userId", async () => {
      const createdAt = new Date("2026-01-10T10:00:00.000Z");
      prismaMock.favoriteTrack.findMany.mockResolvedValue([
        {
          id: "t1",
          userId: USER_A.id,
          provider: "YOUTUBE",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          externalId: "dQw4w9WgXcQ",
          title: "Morning Breath",
          author: "Bodhi",
          thumbnailUrl: null,
          tags: ["Morning"],
          createdAt,
        },
      ]);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(prismaMock.favoriteTrack.findMany).toHaveBeenCalledWith({
        where: { userId: USER_A.id },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      });

      const data = (await res.json()) as { tracks: Array<{ id: string }> };
      expect(data.tracks).toHaveLength(1);
      expect(data.tracks[0].id).toBe("t1");
    });

    it("rejects empty or unsupported URLs with 400", async () => {
      const emptyRes = await POST(
        jsonRequest("http://localhost/api/tracks", "POST", { url: "" })
      );
      expect(emptyRes.status).toBe(400);

      const unsupportedRes = await POST(
        jsonRequest("http://localhost/api/tracks", "POST", {
          url: "https://example.com/not-a-track",
        })
      );
      expect(unsupportedRes.status).toBe(400);
      expect(prismaMock.favoriteTrack.upsert).not.toHaveBeenCalled();
    });

    it("creates a favorite track scoped to the authenticated user", async () => {
      const createdAt = new Date("2026-01-10T10:00:00.000Z");
      prismaMock.favoriteTrack.aggregate.mockResolvedValue({
        _max: { position: 2 },
      });
      prismaMock.favoriteTrack.upsert.mockResolvedValue({
        id: "t-new",
        userId: USER_A.id,
        provider: "DIRECT_AUDIO",
        url: "https://cdn.example.com/calm.mp3",
        externalId: "https://cdn.example.com/calm.mp3",
        title: "Calm Rain",
        author: null,
        thumbnailUrl: null,
        tags: ["Sleep"],
        createdAt,
      });

      const res = await POST(
        jsonRequest("http://localhost/api/tracks", "POST", {
          url: "https://cdn.example.com/calm.mp3",
          title: "Calm Rain",
          thumbnailUrl: null,
          tags: ["  Sleep  ", "sleep"],
        })
      );

      expect(res.status).toBe(201);
      expect(prismaMock.favoriteTrack.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: USER_A.id,
            provider: "DIRECT_AUDIO",
            position: 3,
            tags: ["Sleep"],
          }),
        })
      );
    });
  });

  describe("PATCH & DELETE /api/tracks/[id] (IDOR protection)", () => {
    it("returns 400 when PATCH payload has neither title nor tags", async () => {
      const res = await PATCH(
        jsonRequest("http://localhost/api/tracks/t1", "PATCH", {}),
        { params: Promise.resolve({ id: "t1" }) }
      );
      expect(res.status).toBe(400);
      expect(prismaMock.favoriteTrack.findFirst).not.toHaveBeenCalled();
    });

    it("returns 404 on PATCH when track belongs to another user", async () => {
      prismaMock.favoriteTrack.findFirst.mockResolvedValue(null);

      const res = await PATCH(
        jsonRequest("http://localhost/api/tracks/other-user-track", "PATCH", {
          title: "Hijack attempt",
        }),
        { params: Promise.resolve({ id: "other-user-track" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.favoriteTrack.findFirst).toHaveBeenCalledWith({
        where: { id: "other-user-track", userId: USER_A.id },
      });
      expect(prismaMock.favoriteTrack.update).not.toHaveBeenCalled();
    });

    it("returns 404 on DELETE when track belongs to another user", async () => {
      prismaMock.favoriteTrack.findFirst.mockResolvedValue(null);

      const res = await DELETE(
        new Request("http://localhost/api/tracks/other-user-track", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "other-user-track" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.favoriteTrack.findFirst).toHaveBeenCalledWith({
        where: { id: "other-user-track", userId: USER_A.id },
      });
      expect(prismaMock.favoriteTrack.delete).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/tracks/reorder", () => {
    it("rejects empty orderedIds with 400", async () => {
      const res = await REORDER_PATCH(
        jsonRequest("http://localhost/api/tracks/reorder", "PATCH", {
          orderedIds: [],
        })
      );
      expect(res.status).toBe(400);
    });

    it("ignores foreign track IDs and only reorders tracks owned by the user", async () => {
      prismaMock.favoriteTrack.findMany.mockResolvedValue([
        { id: "t1" },
        { id: "t2" },
      ]);
      prismaMock.favoriteTrack.update.mockImplementation((args) => args);
      prismaMock.$transaction.mockResolvedValue([]);

      const res = await REORDER_PATCH(
        jsonRequest("http://localhost/api/tracks/reorder", "PATCH", {
          orderedIds: ["foreign-track", "t2", "t1"],
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { orderedIds: string[] };
      expect(data.orderedIds).toEqual(["t2", "t1"]);
      expect(prismaMock.favoriteTrack.findMany).toHaveBeenCalledWith({
        where: { userId: USER_A.id },
        select: { id: true },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      });
    });
  });

  describe("POST /api/tracks/resolve", () => {
    it("returns 400 for invalid or unresolved URLs and 200 when metadata resolves", async () => {
      resolveTrackMetadataMock.mockResolvedValueOnce(null);
      const badRes = await RESOLVE_POST(
        jsonRequest("http://localhost/api/tracks/resolve", "POST", {
          url: "https://example.com/nope",
        })
      );
      expect(badRes.status).toBe(400);

      resolveTrackMetadataMock.mockResolvedValueOnce({
        provider: "YOUTUBE",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        externalId: "dQw4w9WgXcQ",
        title: "Guided Calm",
        author: "Channel",
        thumbnailUrl: null,
      });
      const okRes = await RESOLVE_POST(
        jsonRequest("http://localhost/api/tracks/resolve", "POST", {
          url: "https://youtu.be/dQw4w9WgXcQ",
        })
      );
      expect(okRes.status).toBe(200);
    });
  });

  describe("GET /api/tracks/[id]/audio (offline proxy)", () => {
    it("blocks private, loopback, metadata, and non-HTTP URLs against SSRF", () => {
      expect(isSafePublicAudioUrl("https://cdn.example.com/calm.mp3")).toBe(true);
      expect(isSafePublicAudioUrl("http://localhost:3000/a.mp3")).toBe(false);
      expect(isSafePublicAudioUrl("http://127.0.0.1/a.mp3")).toBe(false);
      expect(isSafePublicAudioUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
      expect(isSafePublicAudioUrl("http://192.168.1.10/a.mp3")).toBe(false);
      expect(isSafePublicAudioUrl("http://10.0.0.1/a.mp3")).toBe(false);
      expect(isSafePublicAudioUrl("http://[::1]/a.mp3")).toBe(false);
      expect(isSafePublicAudioUrl("file:///etc/passwd")).toBe(false);
    });

    it("returns 401 when unauthenticated", async () => {
      requireUserMock.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/t1/audio"),
        { params: Promise.resolve({ id: "t1" }) }
      );
      expect(res.status).toBe(401);
    });

    it("returns 404 when track belongs to another user (zero IDOR)", async () => {
      prismaMock.favoriteTrack.findFirst.mockResolvedValueOnce(null);
      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/foreign/audio"),
        { params: Promise.resolve({ id: "foreign" }) }
      );
      expect(res.status).toBe(404);
      expect(prismaMock.favoriteTrack.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign", userId: USER_A.id },
      });
    });

    it("returns 400 for non-DIRECT_AUDIO tracks", async () => {
      prismaMock.favoriteTrack.findFirst.mockResolvedValueOnce({
        id: "t-yt",
        userId: USER_A.id,
        provider: "YOUTUBE",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/t-yt/audio"),
        { params: Promise.resolve({ id: "t-yt" }) }
      );
      expect(res.status).toBe(400);
    });

    it("streams audio bytes with private no-store cache headers for valid DIRECT_AUDIO tracks", async () => {
      prismaMock.favoriteTrack.findFirst.mockResolvedValueOnce({
        id: "t-mp3",
        userId: USER_A.id,
        provider: "DIRECT_AUDIO",
        externalId: "cdn.example.com/meditation.mp3",
        url: "https://cdn.example.com/meditation.mp3",
      });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "Content-Type": "audio/mpeg", "Content-Length": "4" },
          })
        );

      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/t-mp3/audio"),
        { params: Promise.resolve({ id: "t-mp3" }) }
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect((await res.arrayBuffer()).byteLength).toBe(4);
      fetchSpy.mockRestore();
    });

    it("streams GOOGLE_DRIVE tracks with HTTP 206 Range forwarding", async () => {
      const fileId = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
      prismaMock.favoriteTrack.findFirst.mockResolvedValueOnce({
        id: "t-drive",
        userId: USER_A.id,
        provider: "GOOGLE_DRIVE",
        externalId: fileId,
        url: `https://drive.google.com/file/d/${fileId}/view`,
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(new Uint8Array([10, 20]), {
          status: 206,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": "2",
            "Content-Range": "bytes 0-1/100",
            "Accept-Ranges": "bytes",
          },
        })
      );

      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/t-drive/audio", {
          headers: { Range: "bytes=0-1" },
        }),
        { params: Promise.resolve({ id: "t-drive" }) }
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
        expect.objectContaining({
          redirect: "follow",
          headers: expect.objectContaining({ Range: "bytes=0-1" }),
        })
      );
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe("bytes 0-1/100");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(
        new Uint8Array([10, 20])
      );
      fetchSpy.mockRestore();
    });

    it("returns 403 when a GOOGLE_DRIVE file returns HTML (not publicly shared)", async () => {
      const fileId = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
      prismaMock.favoriteTrack.findFirst.mockResolvedValueOnce({
        id: "t-drive-private",
        userId: USER_A.id,
        provider: "GOOGLE_DRIVE",
        externalId: fileId,
        url: `https://drive.google.com/file/d/${fileId}/view`,
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("<html>Sign in</html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      );

      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/t-drive-private/audio"),
        { params: Promise.resolve({ id: "t-drive-private" }) }
      );
      expect(res.status).toBe(403);
      fetchSpy.mockRestore();
    });

    it("returns 413 when upstream Content-Range total exceeds 50 MB", async () => {
      const fileId = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";
      prismaMock.favoriteTrack.findFirst.mockResolvedValueOnce({
        id: "t-drive-huge",
        userId: USER_A.id,
        provider: "GOOGLE_DRIVE",
        externalId: fileId,
        url: `https://drive.google.com/file/d/${fileId}/view`,
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), {
          status: 206,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": "2",
            "Content-Range": `bytes 0-1/${60 * 1024 * 1024}`,
          },
        })
      );

      const res = await AUDIO_GET(
        new Request("http://localhost/api/tracks/t-drive-huge/audio", {
          headers: { Range: "bytes=0-1" },
        }),
        { params: Promise.resolve({ id: "t-drive-huge" }) }
      );
      expect(res.status).toBe(413);
      fetchSpy.mockRestore();
    });
  });
});
