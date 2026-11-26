"use client";

import { useState } from "react";
import { Check, ListMusic, Loader2, Plus, X } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { MAX_PLAYLIST_NAME_LENGTH } from "@/lib/tracks/playlists";
import type { FavoriteTrackItem, TrackPlaylistItem } from "@/lib/tracks/types";

interface AddToPlaylistSheetProps {
  track: FavoriteTrackItem;
  playlists: TrackPlaylistItem[];
  onClose: () => void;
  onPlaylistUpdated: (playlist: TrackPlaylistItem) => void;
  onPlaylistCreated: (playlist: TrackPlaylistItem) => void;
}

export function AddToPlaylistSheet({
  track,
  playlists,
  onClose,
  onPlaylistUpdated,
  onPlaylistCreated,
}: AddToPlaylistSheetProps) {
  const { m } = useI18n();
  const [busyPlaylistId, setBusyPlaylistId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleToggleMembership = async (playlist: TrackPlaylistItem) => {
    setBusyPlaylistId(playlist.id);
    setErrorMessage(null);
    const alreadyIn = playlist.trackIds.includes(track.id);

    try {
      const response = alreadyIn
        ? await fetch(
            `/api/playlists/${encodeURIComponent(playlist.id)}/tracks/${encodeURIComponent(track.id)}`,
            { method: "DELETE" }
          )
        : await fetch(
            `/api/playlists/${encodeURIComponent(playlist.id)}/tracks`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trackIds: [track.id] }),
            }
          );

      const data = (await response.json()) as {
        playlist?: TrackPlaylistItem;
        error?: string;
      };

      if (!response.ok || !data.playlist) {
        setErrorMessage(data.error ?? m.guided.playlists.errModifyTracks);
        return;
      }

      onPlaylistUpdated(data.playlist);
    } catch {
      setErrorMessage(m.guided.playlists.errModifyTracks);
    } finally {
      setBusyPlaylistId(null);
    }
  };

  const handleQuickCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setErrorMessage(m.guided.playlists.errEmptyName);
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          trackIds: [track.id],
        }),
      });

      const data = (await response.json()) as {
        playlist?: TrackPlaylistItem;
        error?: string;
      };

      if (!response.ok || !data.playlist) {
        setErrorMessage(data.error ?? m.guided.playlists.errCreatePlaylist);
        return;
      }

      onPlaylistCreated(data.playlist);
      setNewName("");
    } catch {
      setErrorMessage(m.guided.playlists.errCreatePlaylist);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-xs sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m.guided.playlists.addToPlaylistTitle}
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3.5 rounded-3xl border border-black/8 bg-[var(--surface)] p-5 shadow-xl dark:border-white/10"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
              {m.guided.playlists.addToPlaylistTitle}
            </h3>
            <p className="mt-0.5 truncate text-xs text-[var(--foreground-muted)]">
              {track.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.common.done}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {playlists.length > 0 && (
          <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {playlists.map((playlist) => {
              const isIn = playlist.trackIds.includes(track.id);
              const isBusy = busyPlaylistId === playlist.id;
              return (
                <li key={playlist.id}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleToggleMembership(playlist)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors disabled:opacity-60 ${
                      isIn
                        ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]/60"
                        : "border-black/6 bg-[var(--background)] hover:border-[var(--accent)]/30 dark:border-white/10"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ListMusic
                        className={`h-4 w-4 shrink-0 ${
                          isIn
                            ? "text-[var(--accent)]"
                            : "text-[var(--foreground-muted)]"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">
                          {playlist.name}
                        </p>
                        <p className="text-[11px] text-[var(--foreground-muted)]">
                          {m.guided.playlists.trackCount(
                            playlist.trackIds.length
                          )}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        isIn
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                          : "border-black/20 dark:border-white/25"
                      }`}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isIn ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={handleQuickCreate}
          className="flex flex-col gap-2 border-t border-black/6 pt-3 dark:border-white/10"
        >
          <span className="text-xs font-medium text-[var(--foreground-muted)]">
            {m.guided.playlists.quickCreatePlaylist}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              maxLength={MAX_PLAYLIST_NAME_LENGTH}
              placeholder={m.guided.playlists.namePlaceholder}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
            <button
              type="submit"
              disabled={isCreating || !newName.trim()}
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl bg-[var(--accent)] px-3.5 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {m.common.save}
            </button>
          </div>
        </form>

        {errorMessage && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
