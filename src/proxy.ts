import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig, isAuthConfigured } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/tracks") ||
    pathname.startsWith("/api/sessions")
  ) {
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
