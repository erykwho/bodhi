import { SignJWT, jwtVerify } from "jose";

export const MOBILE_ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const MOBILE_JWT_ISSUER = "bodhi";
const MOBILE_JWT_AUDIENCE = "bodhi-mobile";
const MOBILE_JWT_TYPE = "bodhi-mobile-access";

export interface MobileAccessTokenPayload {
  userId: string;
  email: string;
}

function getSecretBytes(secretOverride?: string): Uint8Array | null {
  const secret = (secretOverride ?? process.env.AUTH_SECRET)?.trim();
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Extracts the raw token from an HTTP `Authorization: Bearer <token>` header.
 */
export function extractBearerToken(
  authHeader: string | null | undefined
): string | null {
  if (!authHeader) return null;
  const match = authHeader.trim().match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * Signs a short-lived HS256 access token for native mobile clients.
 */
export async function signMobileAccessToken(
  user: { id: string; email: string },
  secretOverride?: string,
  ttlSeconds: number = MOBILE_ACCESS_TOKEN_TTL_SEC
): Promise<string> {
  const secretBytes = getSecretBytes(secretOverride);
  if (!secretBytes) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }

  return new SignJWT({
    typ: MOBILE_JWT_TYPE,
    email: user.email.toLowerCase(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(MOBILE_JWT_ISSUER)
    .setAudience(MOBILE_JWT_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretBytes);
}

/**
 * Verifies a native mobile HS256 Bearer access token (Edge- and Node-safe).
 * Returns null if the token is missing, malformed, expired, or invalid.
 */
export async function verifyMobileAccessToken(
  token: string,
  secretOverride?: string
): Promise<MobileAccessTokenPayload | null> {
  const secretBytes = getSecretBytes(secretOverride);
  if (!secretBytes || !token) return null;

  try {
    const { payload } = await jwtVerify(token, secretBytes, {
      algorithms: ["HS256"],
      issuer: MOBILE_JWT_ISSUER,
      audience: MOBILE_JWT_AUDIENCE,
    });

    if (
      payload.typ !== MOBILE_JWT_TYPE ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !payload.email
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      email: payload.email.toLowerCase(),
    };
  } catch {
    return null;
  }
}
