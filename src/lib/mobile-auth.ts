import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  MOBILE_ACCESS_TOKEN_TTL_SEC,
  signMobileAccessToken,
} from "@/lib/mobile-token";
import { prisma } from "@/lib/prisma";

export const MOBILE_REFRESH_TOKEN_TTL_DAYS = 30;
const REFRESH_TOKEN_TTL_MS =
  MOBILE_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getGoogleJwks() {
  if (!googleJwks) {
    googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
  }
  return googleJwks;
}

function getAppleJwks() {
  if (!appleJwks) {
    appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);
  }
  return appleJwks;
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getAllowedGoogleClientIds(): string[] {
  return [
    process.env.AUTH_GOOGLE_ID,
    process.env.MOBILE_GOOGLE_IOS_CLIENT_ID,
    process.env.MOBILE_GOOGLE_ANDROID_CLIENT_ID,
  ]
    .map((val) => val?.trim())
    .filter((val): val is string => Boolean(val));
}

export function getAllowedAppleAudiences(): string[] {
  return [
    process.env.AUTH_APPLE_BUNDLE_ID,
    process.env.AUTH_APPLE_SERVICE_ID,
  ]
    .map((val) => val?.trim())
    .filter((val): val is string => Boolean(val));
}

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Cryptographically verifies a Google Sign-In ID token against Google's official JWKS.
 */
export async function verifyGoogleIdToken(
  idToken: string
): Promise<VerifiedGoogleIdentity | null> {
  const audiences = getAllowedGoogleClientIds();
  if (audiences.length === 0) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }

  try {
    const { payload } = await jwtVerify(idToken, getGoogleJwks(), {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: audiences,
    });

    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !payload.email ||
      payload.email_verified !== true
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === "string" ? payload.name.trim() || null : null,
      image:
        typeof payload.picture === "string"
          ? payload.picture.trim() || null
          : null,
    };
  } catch {
    return null;
  }
}

export interface VerifiedAppleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Cryptographically verifies an Apple Sign-In identityToken against Apple's official JWKS.
 */
export async function verifyAppleIdentityToken(
  identityToken: string
): Promise<VerifiedAppleIdentity | null> {
  const audiences = getAllowedAppleAudiences();
  if (audiences.length === 0) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }

  try {
    const { payload } = await jwtVerify(identityToken, getAppleJwks(), {
      issuer: "https://appleid.apple.com",
      audience: audiences,
    });

    if (typeof payload.sub !== "string" || !payload.sub) {
      return null;
    }

    const email =
      typeof payload.email === "string" && payload.email.trim()
        ? payload.email.trim().toLowerCase()
        : null;
    const emailVerified =
      payload.email_verified === true || payload.email_verified === "true";

    return {
      sub: payload.sub,
      email,
      emailVerified,
    };
  } catch {
    return null;
  }
}

export interface IssuedMobileTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  };
}

/**
 * Issues a fresh short-lived access JWT and persists a hashed opaque refresh token.
 */
export async function issueMobileSessionTokens(
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  },
  deviceName?: string | null
): Promise<IssuedMobileTokens> {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const [accessToken] = await Promise.all([
    signMobileAccessToken({ id: user.id, email: user.email }),
    prisma.mobileRefreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        deviceName: deviceName?.trim().slice(0, 120) || null,
        expiresAt,
      },
    }),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresInSec: MOBILE_ACCESS_TOKEN_TTL_SEC,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
  };
}

/**
 * Rotates a refresh token. If an already-revoked token is replayed (potential
 * token theft), immediately revokes all active refresh tokens for that user.
 */
export async function rotateMobileRefreshToken(
  rawRefreshToken: string
): Promise<IssuedMobileTokens | null> {
  if (!rawRefreshToken) return null;

  const tokenHash = hashRefreshToken(rawRefreshToken);
  const existing = await prisma.mobileRefreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, email: true, name: true, image: true },
      },
    },
  });

  if (!existing || !existing.user) {
    return null;
  }

  const now = new Date();

  // Reuse attack detection: revoke all sessions for this user immediately
  if (existing.revokedAt) {
    await prisma.mobileRefreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return null;
  }

  if (existing.expiresAt <= now) {
    await prisma.mobileRefreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now },
    });
    return null;
  }

  const nextRefreshToken = generateRefreshToken();
  const nextTokenHash = hashRefreshToken(nextRefreshToken);
  const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.mobileRefreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now },
    }),
    prisma.mobileRefreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: nextTokenHash,
        deviceName: existing.deviceName,
        expiresAt: nextExpiresAt,
      },
    }),
  ]);

  const accessToken = await signMobileAccessToken({
    id: existing.user.id,
    email: existing.user.email,
  });

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresInSec: MOBILE_ACCESS_TOKEN_TTL_SEC,
    user: existing.user,
  };
}

/**
 * Revokes a refresh token on logout (idempotent).
 */
export async function revokeMobileRefreshToken(
  rawRefreshToken: string
): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.mobileRefreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
