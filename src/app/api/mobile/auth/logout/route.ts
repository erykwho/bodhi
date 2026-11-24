import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeMobileRefreshToken } from "@/lib/mobile-auth";

const logoutSchema = z.object({
  refreshToken: z.string().trim().min(16).max(512),
});

export async function POST(request: Request) {
  try {
    if (!process.env.DATABASE_URL?.trim()) {
      return NextResponse.json({ ok: true });
    }

    const body = await request.json().catch(() => null);
    const parsed = logoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
        { status: 400 }
      );
    }

    await revokeMobileRefreshToken(parsed.data.refreshToken);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[api/mobile/auth/logout] POST error:", err);
    return NextResponse.json(
      { error: "Failed to revoke mobile session" },
      { status: 500 }
    );
  }
}
