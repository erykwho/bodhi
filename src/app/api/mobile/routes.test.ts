import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  prismaMock,
  verifyGoogleIdTokenMock,
  verifyAppleIdentityTokenMock,
  issueMobileSessionTokensMock,
  rotateMobileRefreshTokenMock,
  revokeMobileRefreshTokenMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  verifyGoogleIdTokenMock: vi.fn(),
  verifyAppleIdentityTokenMock: vi.fn(),
  issueMobileSessionTokensMock: vi.fn(),
  rotateMobileRefreshTokenMock: vi.fn(),
  revokeMobileRefreshTokenMock: vi.fn(),
  prismaMock: {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    favoriteTrack: {
      findMany: vi.fn(),
    },
    trackPlaylist: {
      findMany: vi.fn(),
    },
    meditationSession: {
      findMany: vi.fn(),
    },
    timerPreset: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock,
  authErrorResponse: (err: unknown) => {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "AUTH_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "Authentication and database are not configured yet" },
        { status: 503 }
      );
    }
    return null;
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/mobile-auth", () => ({
  verifyGoogleIdToken: verifyGoogleIdTokenMock,
  verifyAppleIdentityToken: verifyAppleIdentityTokenMock,
  issueMobileSessionTokens: issueMobileSessionTokensMock,
  rotateMobileRefreshToken: rotateMobileRefreshTokenMock,
  revokeMobileRefreshToken: revokeMobileRefreshTokenMock,
}));

import { DELETE as ACCOUNT_DELETE } from "@/app/api/account/route";
import { POST as APPLE_POST } from "@/app/api/mobile/auth/apple/route";
import { POST as GOOGLE_POST } from "@/app/api/mobile/auth/google/route";
import { POST as LOGOUT_POST } from "@/app/api/mobile/auth/logout/route";
import { POST as REFRESH_POST } from "@/app/api/mobile/auth/refresh/route";
import { GET as BOOTSTRAP_GET } from "@/app/api/mobile/bootstrap/route";

const USER_A = {
  id: "user-a",
  email: "a@example.com",
  name: "Alice",
  image: null,
};

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Mobile Auth, Bootstrap & Account Deletion APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-secret-32-chars-minimum-value";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bodhi";
    delete process.env.ALLOWED_EMAILS;
    requireUserMock.mockResolvedValue(USER_A);
  });

  describe("POST /api/mobile/auth/google", () => {
    it("returns 400 on invalid payload", async () => {
      const res = await GOOGLE_POST(
        jsonRequest("http://localhost/api/mobile/auth/google", { idToken: "x" })
      );
      expect(res.status).toBe(400);
    });

    it("returns 401 when Google ID token verification fails", async () => {
      verifyGoogleIdTokenMock.mockResolvedValue(null);
      const res = await GOOGLE_POST(
        jsonRequest("http://localhost/api/mobile/auth/google", {
          idToken: "a".repeat(40),
        })
      );
      expect(res.status).toBe(401);
    });

    it("enforces ALLOWED_EMAILS allowlist (403)", async () => {
      process.env.ALLOWED_EMAILS = "only@allowed.com";
      verifyGoogleIdTokenMock.mockResolvedValue({
        sub: "google-sub-1",
        email: "other@example.com",
        name: "Other",
        image: null,
      });

      const res = await GOOGLE_POST(
        jsonRequest("http://localhost/api/mobile/auth/google", {
          idToken: "a".repeat(40),
        })
      );
      expect(res.status).toBe(403);
      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });

    it("upserts user with googleSub and issues mobile tokens", async () => {
      verifyGoogleIdTokenMock.mockResolvedValue({
        sub: "google-sub-1",
        email: "a@example.com",
        name: "Alice",
        image: "https://example.com/a.png",
      });
      prismaMock.user.upsert.mockResolvedValue(USER_A);
      issueMobileSessionTokensMock.mockResolvedValue({
        accessToken: "jwt-access",
        refreshToken: "opaque-refresh",
        expiresInSec: 900,
        user: USER_A,
      });

      const res = await GOOGLE_POST(
        jsonRequest("http://localhost/api/mobile/auth/google", {
          idToken: "a".repeat(40),
          deviceName: "iPhone 16",
        })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const json = await res.json();
      expect(json.accessToken).toBe("jwt-access");
      expect(prismaMock.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: "a@example.com" },
          create: expect.objectContaining({ googleSub: "google-sub-1" }),
        })
      );
    });
  });

  describe("POST /api/mobile/auth/apple", () => {
    it("authenticates returning Apple users by appleSub even when email is omitted", async () => {
      verifyAppleIdentityTokenMock.mockResolvedValue({
        sub: "apple-sub-999",
        email: null,
        emailVerified: false,
      });
      prismaMock.user.findUnique.mockResolvedValue(USER_A);
      issueMobileSessionTokensMock.mockResolvedValue({
        accessToken: "apple-jwt",
        refreshToken: "apple-refresh",
        expiresInSec: 900,
        user: USER_A,
      });

      const res = await APPLE_POST(
        jsonRequest("http://localhost/api/mobile/auth/apple", {
          identityToken: "b".repeat(40),
        })
      );

      expect(res.status).toBe(200);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { appleSub: "apple-sub-999" } })
      );
    });

    it("rejects first-time Apple sign-in without a verified signed email claim", async () => {
      verifyAppleIdentityTokenMock.mockResolvedValue({
        sub: "apple-sub-new",
        email: null,
        emailVerified: false,
      });
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await APPLE_POST(
        jsonRequest("http://localhost/api/mobile/auth/apple", {
          identityToken: "b".repeat(40),
          email: "spoofed@example.com",
        })
      );

      expect(res.status).toBe(400);
      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/mobile/auth/refresh & logout", () => {
    it("returns 401 when refresh rotation fails", async () => {
      rotateMobileRefreshTokenMock.mockResolvedValue(null);
      const res = await REFRESH_POST(
        jsonRequest("http://localhost/api/mobile/auth/refresh", {
          refreshToken: "r".repeat(32),
        })
      );
      expect(res.status).toBe(401);
    });

    it("revokes refresh token on logout", async () => {
      revokeMobileRefreshTokenMock.mockResolvedValue(undefined);
      const res = await LOGOUT_POST(
        jsonRequest("http://localhost/api/mobile/auth/logout", {
          refreshToken: "r".repeat(32),
        })
      );
      expect(res.status).toBe(200);
      expect(revokeMobileRefreshTokenMock).toHaveBeenCalledWith("r".repeat(32));
    });
  });

  describe("GET /api/mobile/bootstrap", () => {
    it("returns 401 when unauthenticated", async () => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
      const res = await BOOTSTRAP_GET();
      expect(res.status).toBe(401);
    });

    it("scopes all bootstrap queries strictly by userId", async () => {
      prismaMock.favoriteTrack.findMany.mockResolvedValue([]);
      prismaMock.trackPlaylist.findMany.mockResolvedValue([]);
      prismaMock.meditationSession.findMany.mockResolvedValue([]);
      prismaMock.timerPreset.findMany.mockResolvedValue([]);

      const res = await BOOTSTRAP_GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.user.id).toBe("user-a");
      expect(json.playlists).toEqual([]);
      expect(prismaMock.favoriteTrack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-a" } })
      );
      expect(prismaMock.trackPlaylist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-a" } })
      );
      expect(prismaMock.meditationSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-a" } })
      );
      expect(prismaMock.timerPreset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-a" } })
      );
    });
  });

  describe("DELETE /api/account", () => {
    it("returns 401 when unauthenticated", async () => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
      const res = await ACCOUNT_DELETE();
      expect(res.status).toBe(401);
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
    });

    it("deletes strictly the authenticated user record", async () => {
      prismaMock.user.delete.mockResolvedValue(USER_A);

      const res = await ACCOUNT_DELETE();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true });
      expect(prismaMock.user.delete).toHaveBeenCalledWith({
        where: { id: "user-a" },
      });
    });
  });
});
