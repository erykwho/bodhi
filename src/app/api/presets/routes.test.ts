import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    timerPreset: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
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

import { GET, POST } from "@/app/api/presets/route";
import { DELETE } from "@/app/api/presets/[id]/route";
import { MAX_TIMER_PRESETS } from "@/lib/timer/presets";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/presets/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
  });

  describe("Authentication (401)", () => {
    beforeEach(() => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    });

    it("returns 401 for unauthenticated requests across all preset routes", async () => {
      expect((await GET()).status).toBe(401);

      expect(
        (
          await POST(
            jsonRequest("http://localhost/api/presets", "POST", {
              name: "Morning",
              preferences: {},
            })
          )
        ).status
      ).toBe(401);

      expect(
        (
          await DELETE(
            new Request("http://localhost/api/presets/p1", {
              method: "DELETE",
            }),
            { params: Promise.resolve({ id: "p1" }) }
          )
        ).status
      ).toBe(401);
    });
  });

  describe("GET & POST /api/presets", () => {
    it("scopes GET queries strictly by userId", async () => {
      prismaMock.timerPreset.findMany.mockResolvedValue([]);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(prismaMock.timerPreset.findMany).toHaveBeenCalledWith({
        where: { userId: USER_A.id },
        orderBy: { createdAt: "asc" },
        take: MAX_TIMER_PRESETS,
      });
    });

    it("rejects empty names and enforces MAX_TIMER_PRESETS limit with 400", async () => {
      const emptyRes = await POST(
        jsonRequest("http://localhost/api/presets", "POST", {
          name: "   ",
          preferences: {},
        })
      );
      expect(emptyRes.status).toBe(400);

      prismaMock.timerPreset.count.mockResolvedValue(MAX_TIMER_PRESETS);
      const limitRes = await POST(
        jsonRequest("http://localhost/api/presets", "POST", {
          name: "Overflow",
          preferences: {},
        })
      );
      expect(limitRes.status).toBe(400);
      expect(prismaMock.timerPreset.create).not.toHaveBeenCalled();
    });

    it("creates a sanitized preset scoped to the authenticated user", async () => {
      const createdAt = new Date("2026-01-10T10:00:00.000Z");
      prismaMock.timerPreset.count.mockResolvedValue(1);
      prismaMock.timerPreset.create.mockResolvedValue({
        id: "p-new",
        userId: USER_A.id,
        name: "Deep Focus",
        config: { durationMinutes: 25 },
        createdAt,
      });

      const res = await POST(
        jsonRequest("http://localhost/api/presets", "POST", {
          name: "Deep Focus",
          preferences: { durationMinutes: 25, invalidField: "ignored" },
        })
      );

      expect(res.status).toBe(201);
      expect(prismaMock.timerPreset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_A.id,
            name: "Deep Focus",
          }),
        })
      );
    });
  });

  describe("DELETE /api/presets/[id] (IDOR protection)", () => {
    it("returns 404 when preset belongs to another user", async () => {
      prismaMock.timerPreset.findFirst.mockResolvedValue(null);

      const res = await DELETE(
        new Request("http://localhost/api/presets/foreign-preset", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "foreign-preset" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.timerPreset.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign-preset", userId: USER_A.id },
      });
      expect(prismaMock.timerPreset.delete).not.toHaveBeenCalled();
    });
  });
});
