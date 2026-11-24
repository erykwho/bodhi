import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractBearerToken,
  signMobileAccessToken,
  verifyMobileAccessToken,
} from "@/lib/mobile-token";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    mobileRefreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import {
  hashRefreshToken,
  issueMobileSessionTokens,
  revokeMobileRefreshToken,
  rotateMobileRefreshToken,
} from "@/lib/mobile-auth";

const TEST_SECRET = "bodhi-test-jwt-secret-must-be-at-least-32-chars";

describe("mobile-token (Edge-safe Bearer JWT)", () => {
  it("extracts Bearer tokens case-insensitively and rejects malformed headers", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(extractBearerToken("bearer token123")).toBe("token123");
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it("signs and verifies valid mobile access JWTs", async () => {
    const token = await signMobileAccessToken(
      { id: "user-1", email: "Zen@Example.com" },
      TEST_SECRET,
      300
    );

    const payload = await verifyMobileAccessToken(token, TEST_SECRET);
    expect(payload).toEqual({
      userId: "user-1",
      email: "zen@example.com",
    });
  });

  it("rejects tokens signed with a different secret or expired tokens", async () => {
    const token = await signMobileAccessToken(
      { id: "user-1", email: "a@example.com" },
      TEST_SECRET,
      300
    );
    expect(await verifyMobileAccessToken(token, "wrong-secret-32-chars-minimum-123")).toBeNull();

    const expired = await signMobileAccessToken(
      { id: "user-1", email: "a@example.com" },
      TEST_SECRET,
      -5
    );
    expect(await verifyMobileAccessToken(expired, TEST_SECRET)).toBeNull();
  });
});

describe("mobile-auth (refresh token rotation & reuse attack defense)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = TEST_SECRET;
  });

  it("issues an access JWT and persists only the SHA-256 hash of the refresh token", async () => {
    prismaMock.mobileRefreshToken.create.mockResolvedValue({ id: "rt-1" });

    const issued = await issueMobileSessionTokens(
      { id: "user-1", email: "a@example.com", name: "Ana", image: null },
      "iPhone 16 Pro"
    );

    expect(issued.accessToken).toBeTruthy();
    expect(issued.refreshToken.length).toBeGreaterThan(24);
    expect(prismaMock.mobileRefreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        tokenHash: hashRefreshToken(issued.refreshToken),
        deviceName: "iPhone 16 Pro",
      }),
    });
  });

  it("rotates a valid refresh token inside a transaction", async () => {
    prismaMock.mobileRefreshToken.findUnique.mockResolvedValue({
      id: "rt-old",
      userId: "user-1",
      tokenHash: hashRefreshToken("valid-refresh-token-123456"),
      deviceName: "Pixel 9",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { id: "user-1", email: "a@example.com", name: "Ana", image: null },
    });
    prismaMock.$transaction.mockResolvedValue([]);

    const rotated = await rotateMobileRefreshToken("valid-refresh-token-123456");

    expect(rotated).not.toBeNull();
    expect(rotated?.refreshToken).not.toBe("valid-refresh-token-123456");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("revokes ALL user sessions when an already-revoked refresh token is replayed", async () => {
    prismaMock.mobileRefreshToken.findUnique.mockResolvedValue({
      id: "rt-stolen",
      userId: "user-victim",
      tokenHash: hashRefreshToken("replayed-token-12345678"),
      deviceName: "iPhone",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(Date.now() - 5_000),
      user: {
        id: "user-victim",
        email: "victim@example.com",
        name: null,
        image: null,
      },
    });
    prismaMock.mobileRefreshToken.updateMany.mockResolvedValue({ count: 3 });

    const result = await rotateMobileRefreshToken("replayed-token-12345678");
    expect(result).toBeNull();
    expect(prismaMock.mobileRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-victim", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("revokes a refresh token on logout", async () => {
    prismaMock.mobileRefreshToken.updateMany.mockResolvedValue({ count: 1 });
    await revokeMobileRefreshToken("logout-token-12345678");
    expect(prismaMock.mobileRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashRefreshToken("logout-token-12345678"),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
