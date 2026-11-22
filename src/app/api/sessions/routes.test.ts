import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    meditationSession: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    favoriteTrack: {
      findFirst: vi.fn(),
    },
  },
}));

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

import { GET, POST } from "@/app/api/sessions/route";
import { DELETE, PATCH } from "@/app/api/sessions/[id]/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/sessions/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
  });

  describe("Authentication (401)", () => {
    beforeEach(() => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    });

    it("returns 401 for unauthenticated requests across all session routes", async () => {
      expect((await GET()).status).toBe(401);

      expect(
        (
          await POST(
            jsonRequest("http://localhost/api/sessions", "POST", {
              mode: "TIMER",
              actualDurationSec: 600,
            })
          )
        ).status
      ).toBe(401);

      expect(
        (
          await PATCH(
            jsonRequest("http://localhost/api/sessions/s1", "PATCH", {
              note: "Calm",
            }),
            { params: Promise.resolve({ id: "s1" }) }
          )
        ).status
      ).toBe(401);

      expect(
        (
          await DELETE(
            new Request("http://localhost/api/sessions/s1", {
              method: "DELETE",
            }),
            { params: Promise.resolve({ id: "s1" }) }
          )
        ).status
      ).toBe(401);
    });
  });

  describe("GET & POST /api/sessions", () => {
    it("scopes GET queries strictly by userId", async () => {
      prismaMock.meditationSession.findMany.mockResolvedValue([]);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(prismaMock.meditationSession.findMany).toHaveBeenCalledWith({
        where: { userId: USER_A.id },
        orderBy: { endedAt: "desc" },
        take: 200,
      });
    });

    it("rejects invalid payloads with 400", async () => {
      const zeroDur = await POST(
        jsonRequest("http://localhost/api/sessions", "POST", {
          mode: "TIMER",
          actualDurationSec: 0,
        })
      );
      expect(zeroDur.status).toBe(400);

      const badMode = await POST(
        jsonRequest("http://localhost/api/sessions", "POST", {
          mode: "INVALID",
          actualDurationSec: 300,
        })
      );
      expect(badMode.status).toBe(400);
      expect(prismaMock.meditationSession.create).not.toHaveBeenCalled();
    });

    it("does not attach a foreign user's trackId when logging a session", async () => {
      const now = new Date("2026-01-10T10:15:00.000Z");
      const started = new Date("2026-01-10T10:00:00.000Z");
      prismaMock.favoriteTrack.findFirst.mockResolvedValue(null);
      prismaMock.meditationSession.create.mockResolvedValue({
        id: "s-new",
        userId: USER_A.id,
        mode: "TRACK",
        trackId: null,
        trackTitle: "Fallback Title",
        trackProvider: "YOUTUBE",
        plannedDurationSec: null,
        actualDurationSec: 900,
        completed: true,
        note: null,
        startedAt: started,
        endedAt: now,
      });

      const res = await POST(
        jsonRequest("http://localhost/api/sessions", "POST", {
          mode: "TRACK",
          trackId: "foreign-track-id",
          trackTitle: "Fallback Title",
          trackProvider: "YOUTUBE",
          actualDurationSec: 900,
          completed: true,
        })
      );

      expect(res.status).toBe(201);
      expect(prismaMock.favoriteTrack.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign-track-id", userId: USER_A.id },
        select: { id: true, title: true, provider: true },
      });
      expect(prismaMock.meditationSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_A.id,
            trackId: null,
          }),
        })
      );
    });
  });

  describe("PATCH & DELETE /api/sessions/[id] (IDOR protection)", () => {
    it("rejects overly long notes with 400", async () => {
      const res = await PATCH(
        jsonRequest("http://localhost/api/sessions/s1", "PATCH", {
          note: "x".repeat(501),
        }),
        { params: Promise.resolve({ id: "s1" }) }
      );
      expect(res.status).toBe(400);
      expect(prismaMock.meditationSession.findFirst).not.toHaveBeenCalled();
    });

    it("returns 404 on PATCH when session belongs to another user", async () => {
      prismaMock.meditationSession.findFirst.mockResolvedValue(null);

      const res = await PATCH(
        jsonRequest("http://localhost/api/sessions/other-s", "PATCH", {
          note: "Attempt",
        }),
        { params: Promise.resolve({ id: "other-s" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.meditationSession.findFirst).toHaveBeenCalledWith({
        where: { id: "other-s", userId: USER_A.id },
      });
      expect(prismaMock.meditationSession.update).not.toHaveBeenCalled();
    });

    it("returns 404 on DELETE when session belongs to another user", async () => {
      prismaMock.meditationSession.findFirst.mockResolvedValue(null);

      const res = await DELETE(
        new Request("http://localhost/api/sessions/other-s", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "other-s" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.meditationSession.findFirst).toHaveBeenCalledWith({
        where: { id: "other-s", userId: USER_A.id },
      });
      expect(prismaMock.meditationSession.delete).not.toHaveBeenCalled();
    });
  });
});
