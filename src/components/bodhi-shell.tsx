"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Headphones,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
  Timer,
  WifiOff,
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
import { saveMeditationSession } from "@/lib/history/client";
import type { MeditationSessionItem } from "@/lib/history/types";
import {
  isPendingSessionId,
  mergeSessionsWithPending,
  pendingSessionToPayload,
  readCachedHistory,
  readPendingSessions,
  removePendingSession,
  writeCachedHistory,
} from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/offline/use-network-status";
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
  const isOnline = useOnlineStatus();

  const [mode, setMode] = useState<AppMode>("timer");
  const [isSessionActive, setIsSessionActive] = useState<boolean>(false);
  const [dismissedError, setDismissedError] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [sessions, setSessions] =
    useState<MeditationSessionItem[]>(initialSessions);

  const syncingRef = useRef<boolean>(false);

  // Clean ?error= query parameter after rendering any auth notice
  useEffect(() => {
    if (!authError) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("error")) {
      url.searchParams.delete("error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }, [authError]);

  // Hydrate locally queued pending sessions & offline history cache for the signed-in user
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let cancelled = false;
    const pending = readPendingSessions(userId);
    const baseSessions =
      initialSessions.length > 0 ? initialSessions : readCachedHistory(userId);

    if (initialSessions.length > 0) {
      writeCachedHistory(userId, initialSessions);
    }

    if (
      pending.length > 0 ||
      (initialSessions.length === 0 && baseSessions.length > 0)
    ) {
      queueMicrotask(() => {
        if (!cancelled) {
          setSessions(mergeSessionsWithPending(baseSessions, pending));
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [initialSessions, user?.id]);

  // Persist synced history to local cache whenever sessions change
  useEffect(() => {
    if (!user?.id) return;
    writeCachedHistory(user.id, sessions);
  }, [sessions, user?.id]);

  const pendingCount = useMemo(
    () =>
      sessions.filter(
        (item) => item.pendingSync || isPendingSessionId(item.id)
      ).length,
    [sessions]
  );

  // Automatically flush queued offline sessions when connection returns
  useEffect(() => {
    if (!isOnline || !user?.id || pendingCount === 0 || syncingRef.current) {
      return;
    }

    const userId = user.id;
    const pendingList = readPendingSessions(userId);
    if (pendingList.length === 0) return;

    let cancelled = false;
    syncingRef.current = true;

    const flushQueue = async () => {
      await Promise.resolve();
      if (cancelled) {
        syncingRef.current = false;
        return;
      }
      setIsSyncing(true);

      try {
        // Sync oldest first to preserve chronological order
        const chronological = [...pendingList].reverse();
        for (const pendingItem of chronological) {
          if (cancelled || navigator.onLine === false) break;

          const synced = await saveMeditationSession(
            pendingSessionToPayload(pendingItem),
            null
          );
          if (synced && !isPendingSessionId(synced.id)) {
            removePendingSession(userId, pendingItem.id);
            if (!cancelled) {
              setSessions((prev) =>
                mergeSessionsWithPending(
                  [
                    synced,
                    ...prev.filter(
                      (item) =>
                        item.id !== pendingItem.id &&
                        item.id !== synced.id &&
                        !item.pendingSync &&
                        !isPendingSessionId(item.id)
                    ),
                  ],
                  readPendingSessions(userId)
                )
              );
            }
          }
        }
      } finally {
        syncingRef.current = false;
        if (!cancelled) {
          setIsSyncing(false);
        }
      }
    };

    void flushQueue();

    return () => {
      cancelled = true;
    };
  }, [isOnline, pendingCount, user?.id]);

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

  const showNetworkStatus =
    !isSessionActive && (!isOnline || isSyncing || pendingCount > 0);

  const userInitial = (user?.name ?? user?.email ?? "B")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <PullToRefresh disabled={isSessionActive || !isOnline}>
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
                  disabled={!isOnline}
                  title={
                    isOnline
                      ? `Sign out (${user.email})`
                      : "Reconnect to sign out"
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-black/6 bg-[var(--surface)] pr-3 pl-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50 dark:border-white/10"
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
              authConfigured &&
              isOnline && (
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

        {/* Subtle Offline / Sync Status Pill (never shown during active sessions) */}
        {showNetworkStatus && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2.5 flex items-center justify-center"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-[var(--surface)] px-3 py-1 text-[11px] font-medium text-[var(--foreground-muted)] shadow-2xs dark:border-white/10">
              {!isOnline ? (
                <>
                  <WifiOff className="h-3 w-3 text-[var(--warm-amber)]" />
                  {pendingCount > 0
                    ? `Offline · ${pendingCount} ${pendingCount === 1 ? "session" : "sessions"} pending sync`
                    : "Offline · Timer ready"}
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin text-[var(--accent)]" />
                  {`Syncing ${pendingCount} ${pendingCount === 1 ? "session" : "sessions"}...`}
                </>
              )}
            </span>
          </div>
        )}

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
              userId={user?.id ?? null}
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
              isOnline={isOnline}
              onSwitchToTimer={() => setMode("timer")}
              onSessionActiveChange={setIsSessionActive}
              onSessionSaved={handleSessionSaved}
              onSessionUpdated={handleSessionUpdated}
            />
          )}
          {mode === "history" && (
            <MeditationHistory
              user={user}
              authConfigured={authConfigured}
              isOnline={isOnline}
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
