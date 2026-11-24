import { NextResponse } from "next/server";
import { z } from "zod";
import { isEmailAllowed } from "@/auth.config";
import { authErrorResponse } from "@/lib/auth";
import {
  issueMobileSessionTokens,
  verifyGoogleIdToken,
} from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

const googleAuthSchema = z.object({
  idToken: z.string().trim().min(20, "Google ID token is required").max(4096),
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
    const parsed = googleAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
        { status: 400 }
      );
    }

    const identity = await verifyGoogleIdToken(parsed.data.idToken);
    if (!identity) {
      return NextResponse.json(
        { error: "Invalid Google ID token" },
        { status: 401 }
      );
    }

    if (!isEmailAllowed(identity.email)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const user = await prisma.user.upsert({
      where: { email: identity.email },
      update: {
        googleSub: identity.sub,
        name: identity.name ?? undefined,
        image: identity.image ?? undefined,
      },
      create: {
        email: identity.email,
        googleSub: identity.sub,
        name: identity.name,
        image: identity.image,
      },
      select: { id: true, email: true, name: true, image: true },
    });

    const tokens = await issueMobileSessionTokens(user, parsed.data.deviceName);
    return NextResponse.json(tokens, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/mobile/auth/google] POST error:", err);
    return NextResponse.json(
      { error: "Failed to authenticate with Google" },
      { status: 500 }
    );
  }
}
