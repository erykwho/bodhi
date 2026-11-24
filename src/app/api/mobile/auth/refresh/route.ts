import { NextResponse } from "next/server";
import { z } from "zod";
import { rotateMobileRefreshToken } from "@/lib/mobile-auth";

const refreshSchema = z.object({
  refreshToken: z
    .string()
    .trim()
    .min(16, "Refresh token is required")
    .max(512),
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
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
        { status: 400 }
      );
    }

    const tokens = await rotateMobileRefreshToken(parsed.data.refreshToken);
    if (!tokens) {
      return NextResponse.json(
        { error: "Invalid or expired refresh token" },
        { status: 401 }
      );
    }

    return NextResponse.json(tokens, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[api/mobile/auth/refresh] POST error:", err);
    return NextResponse.json(
      { error: "Failed to refresh session" },
      { status: 500 }
    );
  }
}
