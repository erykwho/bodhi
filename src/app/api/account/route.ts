import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const AUTH_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

/**
 * Permanently deletes the authenticated user's account and cascades all
 * user-owned records (tracks, sessions, presets, mobile refresh tokens).
 * Required for Apple App Store and Google Play Store account deletion compliance.
 */
export async function DELETE() {
  try {
    const user = await requireUser();

    await prisma.user.delete({
      where: { id: user.id },
    });

    const response = NextResponse.json(
      { deleted: true },
      { headers: { "Cache-Control": "no-store" } }
    );

    for (const cookieName of AUTH_COOKIE_NAMES) {
      response.cookies.set(cookieName, "", {
        maxAge: 0,
        path: "/",
      });
    }

    return response;
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("[api/account] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}
