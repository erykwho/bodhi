"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Headphones,
  LogIn,
  LogOut,
  Moon,
  Sun,
  Timer,
  X,
} from "lucide-react";
import { signInWithGoogle, signOutUser } from "@/app/actions";
import { BodhiLogo } from "@/components/bodhi-logo";
import { GuidedTracks } from "@/components/guided-tracks";
import { MeditationHistory } from "@/components/meditation-history";
import { MeditationTimer } from "@/components/meditation-timer";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useTheme } from "@/components/theme-provider";
import type { SessionUserSummary } from "@/lib/auth";
import type { MeditationSessionItem } from "@/lib/history/types";
import type { FavoriteTrackItem } from "@/lib/tracks/types";

type AppMode = "timer" | "guided" | "history";

interface BodhiShellProps {
  user: SessionUserSummary | null;
  authConfigured: boolean;
  initialTracks: FavoriteTrackItem[];
  initialSessions: MeditationSessionItem[];
  authError?: string | null;
}

export function BodhiShell({
  user,
  authConfigured,
  initialTracks,
  initialSessions,
  authError = null,
}: BodhiShellProps) {
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<AppMode>("timer");
  const [isSessionActive, setIsSessionActive] = useState<boolean>(false);
  const [dismissedError, setDismissedError] = useState<boolean>(false);
  const [sessions, setSessions] =
    useState<MeditationSessionItem[]>(initialSessions);

  useEffect(() => {
    if (!authError) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("error")) {
      url.searchParams.delete("error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }, [authError]);

  const handleSessionSaved = useCallback((saved: MeditationSessionItem) => {
    setSessions((prev) => [
      saved,
      ...prev.filter((item) => item.id !== saved.id),
    ]);
  }, []);

  const handleSessionUpdated = useCallback((updated: MeditationSessionItem) => {
    setSessions((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
  }, []);

  const handleSessionDeleted = useCallback((id: string) => {
    setSessions((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showAuthError = Boolean(authError && !user && !dismissedError);
  const authErrorMessage =
    authError === "AccessDenied"
      ? "Access denied. Your Google account is not on the allowed emails list."
      : "Sign-in was interrupted or expired. Please try signing in again.";

  const userInitial = (user?.name ?? user?.email ?? "B")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <PullToRefresh disabled={isSessionActive}>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-4 pb-safe">
        {/* Top Bar */}
        <header className="flex items-center justify-between gap-2 py-1">
          <div className="flex items-center gap-2.5">
            <BodhiLogo className="h-7 w-7" />
            <span className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
              Bodhi
            </span>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <form action={signOutUser}>
                <button
                  type="submit"
                  title={`Sign out (${user.email})`}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-black/6 bg-[var(--surface)] pr-3 pl-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
                >
                  {user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.image}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">
                      {userInitial}
                    </span>
                  )}
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              authConfigured && (
                <form action={signInWithGoogle}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/6 bg-[var(--surface)] px-3 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Sign in
                  </button>
                </form>
              )
            )}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              className="flex h-9 w-9 items-center justify-center rounded-full border border-black/6 bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        {/* Dismissible Auth Error Banner */}
        {showAuthError && (
          <div
            role="alert"
            className="mt-3 flex items-start justify-between gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-[var(--foreground)]"
          >
            <p className="leading-relaxed">{authErrorMessage}</p>
            <button
              type="button"
              onClick={() => setDismissedError(true)}
              aria-label="Dismiss message"
              className="shrink-0 rounded-lg p-0.5 text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Single-row Mode Switcher (hidden during active sessions) */}
        {!isSessionActive && (
          <nav
            aria-label="Practice mode"
            className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-[var(--surface-muted)] p-1"
          >
            <button
              type="button"
              onClick={() => setMode("timer")}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                mode === "timer"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                  : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <Timer className="h-3.5 w-3.5" />
              Timer
            </button>
            <button
              type="button"
              onClick={() => setMode("guided")}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                mode === "guided"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                  : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <Headphones className="h-3.5 w-3.5" />
              Guided
            </button>
            <button
              type="button"
              onClick={() => setMode("history")}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                mode === "history"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                  : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              History
            </button>
          </nav>
        )}

        {/* Active View */}
        <main className="flex flex-1 flex-col justify-between gap-4 py-4">
          {mode === "timer" && (
            <MeditationTimer
              isAuthenticated={Boolean(user)}
              onSessionActiveChange={setIsSessionActive}
              onSessionSaved={handleSessionSaved}
              onSessionUpdated={handleSessionUpdated}
            />
          )}
          {mode === "guided" && (
            <GuidedTracks
              user={user}
              authConfigured={authConfigured}
              initialTracks={initialTracks}
              onSessionActiveChange={setIsSessionActive}
              onSessionSaved={handleSessionSaved}
              onSessionUpdated={handleSessionUpdated}
            />
          )}
          {mode === "history" && (
            <MeditationHistory
              user={user}
              authConfigured={authConfigured}
              sessions={sessions}
              onSessionUpdated={handleSessionUpdated}
              onSessionDeleted={handleSessionDeleted}
            />
          )}
        </main>
      </div>
    </PullToRefresh>
  );
}
