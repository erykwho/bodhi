import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig, isAuthConfigured, isEmailAllowed } from "@/auth.config";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      if (!isEmailAllowed(user.email)) {
        return false;
      }

      const email = user.email!.toLowerCase();
      await prisma.user.upsert({
        where: { email },
        update: {
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        },
        create: {
          email,
          name: user.name ?? null,
          image: user.image ?? null,
        },
      });

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { id: true },
        });
        if (dbUser) {
          token.userId = dbUser.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});

export interface SessionUserSummary {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Safely resolves the signed-in user for optional-auth pages.
 * Returns null when unauthenticated or when Auth/DB env vars are not configured.
 */
export async function getOptionalSessionUser(): Promise<SessionUserSummary | null> {
  if (!isAuthConfigured() || !process.env.DATABASE_URL?.trim()) {
    return null;
  }

  try {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase();
    if (!email) return null;

    const dbUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, image: true },
    });

    if (dbUser) return dbUser;

    return await prisma.user.create({
      data: {
        email,
        name: session?.user?.name ?? null,
        image: session?.user?.image ?? null,
      },
      select: { id: true, email: true, name: true, image: true },
    });
  } catch {
    return null;
  }
}

export async function requireUser() {
  if (!isAuthConfigured() || !process.env.DATABASE_URL?.trim()) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    throw new Error("UNAUTHORIZED");
  }

  let dbUser = await prisma.user.findUnique({
    where: { email },
  });

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        email,
        name: session?.user?.name ?? null,
        image: session?.user?.image ?? null,
      },
    });
  }

  return dbUser;
}

export function authErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof Error)) return null;
  if (err.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (err.message === "AUTH_NOT_CONFIGURED") {
    return NextResponse.json(
      { error: "Authentication and database are not configured yet" },
      { status: 503 }
    );
  }
  return null;
}
