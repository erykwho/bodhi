import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Checks whether an email is allowed to sign in.
 * If ALLOWED_EMAILS is unset or empty, any Google account is permitted.
 */
export function isEmailAllowed(email?: string | null): boolean {
  if (!email) return false;
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return true;
  const allowed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(email.toLowerCase());
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET?.trim() &&
      process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim()
  );
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
};
