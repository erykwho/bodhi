"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  BellOff,
  Headphones,
  Link2,
  Loader2,
  LogIn,
  Music2,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { signInWithGoogle } from "@/app/actions";
import { GuidedSessionPlayer } from "@/components/guided-session-player";
import type { SessionUserSummary } from "@/lib/auth";
import type { MeditationSessionItem } from "@/lib/history/types";
import { parseTrackUrl } from "@/lib/tracks/providers";
import type {
  FavoriteTrackItem,
  ResolvedTrackMetadata,
} from "@/lib/tracks/types";

interface GuidedTracksProps {
  user: SessionUserSummary | null;
  authConfigured: boolean;
  initialTracks: FavoriteTrackItem[];
  onSessionActiveChange: (active: boolean) => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
}

export function GuidedTracks({
  user,
  authConfigured,
  initialTracks,
  onSessionActiveChange,
  onSessionSaved,
  onSessionUpdated,
}: GuidedTracksProps) {
  const [tracks, setTracks] = useState<FavoriteTrackItem[]>(initialTracks);
  const [activeTrack, setActiveTrack] = useState<FavoriteTrackItem | null>(
    null
  );
  const [closingBellEnabled, setClosingBellEnabled] = useState<boolean>(true);

  // Add track form state
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>("");
  const [titleInput, setTitleInput] = useState<string>("");
  const [resolvedMeta, setResolvedMeta] =
    useState<ResolvedTrackMetadata | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    onSessionActiveChange(activeTrack !== null);
  }, [activeTrack, onSessionActiveChange]);

  const detectedProvider = parseTrackUrl(urlInput)?.provider ?? null;

  const resetForm = useCallback(() => {
    setUrlInput("");
    setTitleInput("");
    setResolvedMeta(null);
    setErrorMessage(null);
    setIsAdding(false);
  }, []);

  const handleResolveMetadata = useCallback(async (rawUrl: string) => {
    const parsed = parseTrackUrl(rawUrl);
    if (!parsed) {
      setResolvedMeta(null);
      return;
    }

    setIsResolving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/tracks/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rawUrl }),
      });

      const data = (await response.json()) as {
        metadata?: ResolvedTrackMetadata;
        error?: string;
      };

      if (!response.ok || !data.metadata) {
        setErrorMessage(data.error ?? "Could not fetch track details.");
        return;
      }

      setResolvedMeta(data.metadata);
      setTitleInput((prev) => (prev.trim() ? prev : data.metadata!.title));
    } catch {
      setErrorMessage("Could not fetch track details right now.");
    } finally {
      setIsResolving(false);
    }
  }, []);

  const handleUrlChange = useCallback(
    (nextValue: string) => {
      setUrlInput(nextValue);
      setErrorMessage(null);
      if (!nextValue.trim()) {
        setResolvedMeta(null);
        setTitleInput("");
        return;
      }
      // Auto-resolve when a valid YouTube or SoundCloud link is pasted
      if (parseTrackUrl(nextValue)) {
        void handleResolveMetadata(nextValue);
      } else {
        setResolvedMeta(null);
      }
    },
    [handleResolveMetadata]
  );

  const handleSaveTrack = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setErrorMessage(null);

      if (!parseTrackUrl(urlInput)) {
        setErrorMessage(
          "Paste a valid YouTube video or SoundCloud track URL."
        );
        return;
      }

      setIsSaving(true);
      try {
        const response = await fetch("/api/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: urlInput,
            title: titleInput.trim() || undefined,
            author: resolvedMeta?.author,
            thumbnailUrl: resolvedMeta?.thumbnailUrl,
          }),
        });

        const data = (await response.json()) as {
          track?: FavoriteTrackItem;
          error?: string;
        };

        if (!response.ok || !data.track) {
          setErrorMessage(data.error ?? "Failed to save favorite track.");
          return;
        }

        const savedTrack = data.track;
        setTracks((prev) => [
          savedTrack,
          ...prev.filter((item) => item.id !== savedTrack.id),
        ]);
        resetForm();
      } catch {
        setErrorMessage("Failed to save favorite track.");
      } finally {
        setIsSaving(false);
      }
    },
    [resetForm, resolvedMeta, titleInput, urlInput]
  );

  const handleDeleteTrack = useCallback(async (id: string) => {
    setDeletingId(id);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/tracks/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setErrorMessage(data.error ?? "Failed to delete track.");
        return;
      }

      setTracks((prev) => prev.filter((item) => item.id !== id));
    } catch {
      setErrorMessage("Failed to delete track.");
    } finally {
      setDeletingId(null);
    }
  }, []);

  if (activeTrack) {
    return (
      <GuidedSessionPlayer
        track={activeTrack}
        closingBellEnabled={closingBellEnabled}
        isAuthenticated={Boolean(user)}
        onToggleClosingBell={() => setClosingBellEnabled((prev) => !prev)}
        onExit={() => setActiveTrack(null)}
        onSessionSaved={onSessionSaved}
        onSessionUpdated={onSessionUpdated}
      />
    );
  }

  // Signed-out state
  if (!user) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Headphones className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            Favorite Guided Tracks
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
            Save your favorite YouTube and SoundCloud meditations and listen to
            the full track in a calm, distraction-free session synced across
            devices.
          </p>

          {authConfigured ? (
            <form action={signInWithGoogle} className="mt-5">
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
              >
                <LogIn className="h-4 w-4" />
                Continue with Google
              </button>
            </form>
          ) : (
            <p className="mt-4 rounded-xl bg-[var(--surface-muted)] px-3.5 py-2.5 text-xs text-[var(--foreground-muted)]">
              Configure Google OAuth and Neon Postgres environment variables to
              enable cloud-synced favorite tracks.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col gap-4 py-1">
      {/* Top Action Row */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setClosingBellEnabled((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
        >
          {closingBellEnabled ? (
            <Bell className="h-3.5 w-3.5 text-[var(--accent)]" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
          Closing bell: {closingBellEnabled ? "On" : "Off"}
        </button>

        <button
          type="button"
          onClick={() => (isAdding ? resetForm() : setIsAdding(true))}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
        >
          {isAdding ? (
            <>
              <X className="h-3.5 w-3.5" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Add Track
            </>
          )}
        </button>
      </div>

      {/* Add Favorite Track Form */}
      {isAdding && (
        <form
          onSubmit={handleSaveTrack}
          className="flex flex-col gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] p-4 shadow-xs dark:border-white/10"
        >
          <div className="flex items-center justify-between">
            <label
              htmlFor="track-url-input"
              className="text-xs font-medium text-[var(--foreground)]"
            >
              YouTube or SoundCloud URL
            </label>
            {detectedProvider && (
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                {detectedProvider === "YOUTUBE" ? "YouTube" : "SoundCloud"}
              </span>
            )}
          </div>

          <div className="relative flex items-center">
            <Link2 className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--foreground-muted)]" />
            <input
              id="track-url-input"
              type="url"
              required
              placeholder="https://youtube.com/watch?v=... or soundcloud.com/..."
              value={urlInput}
              onChange={(event) => handleUrlChange(event.target.value)}
              className="h-11 w-full rounded-xl border border-black/10 bg-[var(--background)] pr-9 pl-9 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
            {isResolving && (
              <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-[var(--accent)]" />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="track-title-input"
              className="text-xs font-medium text-[var(--foreground)]"
            >
              Title
            </label>
            <input
              id="track-title-input"
              type="text"
              placeholder="Auto-filled from track link (editable)"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
          </div>

          {errorMessage && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving || !urlInput.trim()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save to Favorites"
            )}
          </button>
        </form>
      )}

      {errorMessage && !isAdding && (
        <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      {/* Favorite Tracks List */}
      {tracks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-black/12 bg-[var(--surface)]/60 px-6 py-12 text-center dark:border-white/12">
          <Music2 className="h-7 w-7 text-[var(--foreground-muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
            No favorite tracks yet
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
            Tap &ldquo;Add Track&rdquo; to save a YouTube or SoundCloud guided
            meditation.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="flex items-center gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] p-3 shadow-xs transition-colors hover:border-[var(--accent)]/35 dark:border-white/10"
            >
              <button
                type="button"
                onClick={() => setActiveTrack(track)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  {track.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Music2 className="h-5 w-5" />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                    <Play className="h-4 w-4 fill-current" />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                    {track.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                    <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">
                      {track.provider === "YOUTUBE" ? "YouTube" : "SoundCloud"}
                    </span>
                    {track.author && (
                      <span className="truncate">{track.author}</span>
                    )}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => void handleDeleteTrack(track.id)}
                disabled={deletingId === track.id}
                aria-label={`Remove ${track.title}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
              >
                {deletingId === track.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
