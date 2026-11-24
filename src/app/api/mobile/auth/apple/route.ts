import { NextResponse } from "next/server";
import { z } from "zod";
import { isEmailAllowed } from "@/auth.config";
import { authErrorResponse } from "@/lib/auth";
import {
  issueMobileSessionTokens,
  verifyAppleIdentityToken,
} from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

const appleAuthSchema = z.object({
  identityToken: z
    .string()
    .trim()
    .min(20, "Apple identity token is required")
    .max(4096),
  fullName: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  deviceName: z.string().trim().max(120).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    if (!process.env.AUTH_SECRET?.trim() || !process.env.DATABASE_URL?.trim()) {
      return NextResponse.json(
        { error: "Authentication and database are not configured yet" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = appleAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
        { status: 400 }
      );
    }

    const identity = await verifyAppleIdentityToken(parsed.data.identityToken);
    if (!identity) {
      return NextResponse.json(
        { error: "Invalid Apple identity token" },
        { status: 401 }
      );
    }

    const providedName = parsed.data.fullName?.trim() || null;

    // 1. Returning Sign in with Apple user (Apple omits email/name after first sign-in)
    let user = await prisma.user.findUnique({
      where: { appleSub: identity.sub },
      select: { id: true, email: true, name: true, image: true },
    });

    if (user) {
      if (!isEmailAllowed(user.email)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (!user.name && providedName) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { name: providedName },
          select: { id: true, email: true, name: true, image: true },
        });
      }
    } else {
      // 2. First-time Apple sign-in: rely strictly on cryptographically signed email claim
      if (!identity.email || !identity.emailVerified) {
        return NextResponse.json(
          { error: "Verified email is required for first-time Apple sign-in" },
          { status: 400 }
        );
      }

      if (!isEmailAllowed(identity.email)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      user = await prisma.user.upsert({
        where: { email: identity.email },
        update: {
          appleSub: identity.sub,
          ...(providedName ? { name: providedName } : {}),
        },
        create: {
          email: identity.email,
          appleSub: identity.sub,
          name: providedName,
        },
        select: { id: true, email: true, name: true, image: true },
      });
    }

    const tokens = await issueMobileSessionTokens(user, parsed.data.deviceName);
    return NextResponse.json(tokens, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/mobile/auth/apple] POST error:", err);
    return NextResponse.json(
      { error: "Failed to authenticate with Apple" },
      { status: 500 }
    );
  }
}
