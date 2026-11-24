import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig, isAuthConfigured } from "@/auth.config";
import {
  extractBearerToken,
  verifyMobileAccessToken,
} from "@/lib/mobile-token";

const { auth } = NextAuth(authConfig);

function isProtectedApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/tracks") ||
    pathname.startsWith("/api/sessions") ||
    pathname.startsWith("/api/presets") ||
    pathname.startsWith("/api/account") ||
    pathname.startsWith("/api/mobile/bootstrap")
  );
}

export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;

  if (isProtectedApiPath(pathname)) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.trim()) {
      if (!process.env.AUTH_SECRET?.trim()) {
        return NextResponse.json(
          { error: "Authentication is not configured yet" },
          { status: 503 }
        );
      }

      const bearerToken = extractBearerToken(authHeader);
      const verified = bearerToken
        ? await verifyMobileAccessToken(bearerToken)
        : null;

      if (!verified) {
        return NextResponse.json(
          { error: "Not authenticated" },
          { status: 401 }
        );
      }

      return NextResponse.next();
    }

    if (!isAuthConfigured()) {
      return NextResponse.json(
        { error: "Authentication is not configured yet" },
        { status: 503 }
      );
    }

    if (!req.auth?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)",
  ],
};
