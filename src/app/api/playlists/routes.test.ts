import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, prismaMock, resolveExternalPlaylistMock } = vi.hoisted(
  () => ({
    requireUserMock: vi.fn(),
    resolveExternalPlaylistMock: vi.fn(),
    prismaMock: {
      trackPlaylist: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      playlistTrack: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
        update: vi.fn(),
      },
      favoriteTrack: {
        findMany: vi.fn(),
        aggregate: vi.fn(),
        upsert: vi.fn(),
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

vi.mock("@/lib/tracks/playlist-resolver", () => ({
  resolveExternalPlaylist: resolveExternalPlaylistMock,
}));

import { GET, POST } from "@/app/api/playlists/route";
import { DELETE, PATCH } from "@/app/api/playlists/[id]/route";
import { POST as ADD_TRACKS_POST } from "@/app/api/playlists/[id]/tracks/route";
import { DELETE as REMOVE_TRACK_DELETE } from "@/app/api/playlists/[id]/tracks/[trackId]/route";
import { PATCH as REORDER_PATCH } from "@/app/api/playlists/[id]/reorder/route";
import { POST as RESOLVE_POST } from "@/app/api/playlists/resolve/route";
import { POST as IMPORT_POST } from "@/app/api/playlists/import/route";
import {
  MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS,
  MAX_PLAYLISTS_PER_USER,
} from "@/lib/tracks/playlists";

const USER_A = { id: "user-a", email: "a@example.com" };
const NOW = new Date("2026-11-26T12:00:00.000Z");

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/playlists/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
  });

  describe("Authentication (401)", () => {
    beforeEach(() => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    });

    it("returns 401 for unauthenticated requests across every playlist route", async () => {
      expect((await GET()).status).toBe(401);
      expect(
        (
          await POST(
            jsonRequest("http://localhost/api/playlists", "POST", {
              name: "Morning",
            })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await PATCH(
            jsonRequest("http://localhost/api/playlists/p1", "PATCH", {
              name: "Updated",
            }),
            { params: Promise.resolve({ id: "p1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await DELETE(
            new Request("http://localhost/api/playlists/p1", {
              method: "DELETE",
            }),
            { params: Promise.resolve({ id: "p1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await ADD_TRACKS_POST(
            jsonRequest("http://localhost/api/playlists/p1/tracks", "POST", {
              trackIds: ["t1"],
            }),
            { params: Promise.resolve({ id: "p1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await REMOVE_TRACK_DELETE(
            new Request("http://localhost/api/playlists/p1/tracks/t1", {
              method: "DELETE",
            }),
            { params: Promise.resolve({ id: "p1", trackId: "t1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await REORDER_PATCH(
            jsonRequest("http://localhost/api/playlists/p1/reorder", "PATCH", {
              orderedTrackIds: ["t1"],
            }),
            { params: Promise.resolve({ id: "p1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await RESOLVE_POST(
            jsonRequest("http://localhost/api/playlists/resolve", "POST", {
              url: "https://www.youtube.com/playlist?list=PL1234567890",
            })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await IMPORT_POST(
            jsonRequest("http://localhost/api/playlists/import", "POST", {
              mode: "new",
              name: "Course",
              tracks: [
                {
                  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                  title: "Day 1",
                },
              ],
            })
          )
        ).status
      ).toBe(401);
    });
  });

  describe("GET & POST /api/playlists", () => {
    it("scopes GET strictly by userId", async () => {
      prismaMock.trackPlaylist.findMany.mockResolvedValue([
        {
          id: "p1",
          name: "Morning Routine",
          description: "Start calm",
          createdAt: NOW,
          updatedAt: NOW,
          items: [{ trackId: "t2" }, { trackId: "t1" }],
        },
      ]);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(prismaMock.trackPlaylist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_A.id } })
      );
      const data = (await res.json()) as {
        playlists: Array<{ id: string; trackIds: string[] }>;
      };
      expect(data.playlists[0].trackIds).toEqual(["t2", "t1"]);
    });

    it("enforces MAX_PLAYLISTS_PER_USER cap and filters out foreign trackIds", async () => {
      prismaMock.trackPlaylist.count.mockResolvedValueOnce(
        MAX_PLAYLISTS_PER_USER
      );
      const capRes = await POST(
        jsonRequest("http://localhost/api/playlists", "POST", { name: "Extra" })
      );
      expect(capRes.status).toBe(400);

      prismaMock.trackPlaylist.count.mockResolvedValueOnce(1);
      prismaMock.favoriteTrack.findMany.mockResolvedValueOnce([{ id: "t-own" }]);
      prismaMock.trackPlaylist.aggregate.mockResolvedValueOnce({
        _max: { position: 0 },
      });
      prismaMock.trackPlaylist.create.mockResolvedValueOnce({
        id: "p-new",
        name: "Evening",
        description: null,
        createdAt: NOW,
        updatedAt: NOW,
        items: [{ trackId: "t-own" }],
      });

      const okRes = await POST(
        jsonRequest("http://localhost/api/playlists", "POST", {
          name: "Evening",
          trackIds: ["t-own", "t-foreign"],
        })
      );
      expect(okRes.status).toBe(201);
      expect(prismaMock.trackPlaylist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_A.id,
            items: { create: [{ trackId: "t-own", position: 0 }] },
          }),
        })
      );
    });
  });

  describe("IDOR protection on /api/playlists/[id]/**", () => {
    it("returns 404 when patching, deleting, modifying tracks, or reordering another user's playlist", async () => {
      prismaMock.trackPlaylist.findFirst.mockResolvedValue(null);

      expect(
        (
          await PATCH(
            jsonRequest("http://localhost/api/playlists/foreign", "PATCH", {
              name: "Hijack",
            }),
            { params: Promise.resolve({ id: "foreign" }) }
          )
        ).status
      ).toBe(404);

      expect(
        (
          await DELETE(
            new Request("http://localhost/api/playlists/foreign", {
              method: "DELETE",
            }),
            { params: Promise.resolve({ id: "foreign" }) }
          )
        ).status
      ).toBe(404);

      expect(
        (
          await ADD_TRACKS_POST(
            jsonRequest("http://localhost/api/playlists/foreign/tracks", "POST", {
              trackIds: ["t1"],
            }),
            { params: Promise.resolve({ id: "foreign" }) }
          )
        ).status
      ).toBe(404);

      expect(
        (
          await REMOVE_TRACK_DELETE(
            new Request("http://localhost/api/playlists/foreign/tracks/t1", {
              method: "DELETE",
            }),
            { params: Promise.resolve({ id: "foreign", trackId: "t1" }) }
          )
        ).status
      ).toBe(404);

      expect(
        (
          await REORDER_PATCH(
            jsonRequest(
              "http://localhost/api/playlists/foreign/reorder",
              "PATCH",
              { orderedTrackIds: ["t1"] }
            ),
            { params: Promise.resolve({ id: "foreign" }) }
          )
        ).status
      ).toBe(404);
    });
  });

  describe("POST /api/playlists/resolve & /api/playlists/import", () => {
    it("rejects unsupported playlist URLs with 400 and resolves valid playlists", async () => {
      const badRes = await RESOLVE_POST(
        jsonRequest("http://localhost/api/playlists/resolve", "POST", {
          url: "https://example.com/not-a-playlist",
        })
      );
      expect(badRes.status).toBe(400);

      resolveExternalPlaylistMock.mockResolvedValueOnce({
        provider: "YOUTUBE",
        externalId: "PL1234567890",
        url: "https://www.youtube.com/playlist?list=PL1234567890",
        title: "21 Days",
        author: "Guide",
        totalCount: 60,
        truncated: true,
        limit: 50,
        tracks: [
          {
            provider: "YOUTUBE",
            externalId: "dQw4w9WgXcQ",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Day 1",
            author: "Guide",
            thumbnailUrl: null,
          },
        ],
      });

      const okRes = await RESOLVE_POST(
        jsonRequest("http://localhost/api/playlists/resolve", "POST", {
          url: "https://www.youtube.com/playlist?list=PL1234567890",
        })
      );
      expect(okRes.status).toBe(200);
      const data = (await okRes.json()) as {
        playlist: { truncated: boolean; totalCount: number };
      };
      expect(data.playlist.truncated).toBe(true);
      expect(data.playlist.totalCount).toBe(60);
    });

    it("rejects imports exceeding MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS (50)", async () => {
      const tooMany = Array.from(
        { length: MAX_EXTERNAL_PLAYLIST_IMPORT_TRACKS + 1 },
        (_, i) => ({
          url: `https://www.youtube.com/watch?v=vid000000${String(i).padStart(2, "0")}`,
          title: `Track ${i}`,
        })
      );

      const res = await IMPORT_POST(
        jsonRequest("http://localhost/api/playlists/import", "POST", {
          mode: "new",
          name: "Huge",
          tracks: tooMany,
        })
      );
      expect(res.status).toBe(400);
    });

    it("imports tracks into a new playlist and upserts tracks into user library", async () => {
      prismaMock.trackPlaylist.count.mockResolvedValueOnce(0);
      prismaMock.favoriteTrack.aggregate.mockResolvedValueOnce({
        _max: { position: 0 },
      });
      prismaMock.favoriteTrack.upsert.mockImplementation((args) => args);
      prismaMock.$transaction.mockResolvedValueOnce([
        {
          id: "t-upserted-1",
          userId: USER_A.id,
          provider: "YOUTUBE",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          externalId: "dQw4w9WgXcQ",
          title: "Day 1",
          author: "Guide",
          thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          tags: [],
          isFavorite: false,
          createdAt: NOW,
        },
      ]);
      prismaMock.trackPlaylist.aggregate.mockResolvedValueOnce({
        _max: { position: null },
      });
      prismaMock.trackPlaylist.create.mockResolvedValueOnce({
        id: "pl-imported",
        name: "21 Days",
        description: "Morning series",
        createdAt: NOW,
        updatedAt: NOW,
        items: [{ trackId: "t-upserted-1" }],
      });

      const res = await IMPORT_POST(
        jsonRequest("http://localhost/api/playlists/import", "POST", {
          mode: "new",
          name: "21 Days",
          description: "Morning series",
          tracks: [
            {
              url: "https://youtu.be/dQw4w9WgXcQ",
              title: "Day 1",
              author: "Guide",
            },
          ],
        })
      );

      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        playlist: { id: string; trackIds: string[] };
        tracks: Array<{ id: string }>;
        addedCount: number;
      };
      expect(data.playlist.id).toBe("pl-imported");
      expect(data.playlist.trackIds).toEqual(["t-upserted-1"]);
      expect(data.tracks).toHaveLength(1);
      expect(data.addedCount).toBe(1);
    });

    it("returns 404 when importing into another user's existing playlist", async () => {
      prismaMock.trackPlaylist.findFirst.mockResolvedValueOnce(null);

      const res = await IMPORT_POST(
        jsonRequest("http://localhost/api/playlists/import", "POST", {
          mode: "existing",
          playlistId: "foreign-playlist",
          tracks: [
            {
              url: "https://youtu.be/dQw4w9WgXcQ",
              title: "Day 1",
            },
          ],
        })
      );
      expect(res.status).toBe(404);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
