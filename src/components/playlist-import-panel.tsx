"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  Link2,
  ListMusic,
  Loader2,
  Music2,
  X,
} from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  parsePlaylistUrl,
} from "@/lib/tracks/playlists";
import type {
  FavoriteTrackItem,
  ResolvedExternalPlaylist,
  TrackPlaylistItem,
} from "@/lib/tracks/types";

export interface ImportedPlaylistPayloadResult {
  playlist: TrackPlaylistItem;
  tracks: FavoriteTrackItem[];
  addedCount: number;
  skippedDuplicateCount: number;
  skippedCapCount: number;
}

interface PlaylistImportPanelProps {
  initialUrl?: string;
  playlists: TrackPlaylistItem[];
  defaultTargetPlaylistId?: string | null;
  onCancel: () => void;
  onImported: (result: ImportedPlaylistPayloadResult) => void;
}

export function PlaylistImportPanel({
  initialUrl = "",
  playlists,
  defaultTargetPlaylistId = null,
  onCancel,
  onImported,
}: PlaylistImportPanelProps) {
  const { m } = useI18n();
  const [urlInput, setUrlInput] = useState<string>(initialUrl);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [resolved, setResolved] = useState<ResolvedExternalPlaylist | null>(
    null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const hasExistingPlaylists = playlists.length > 0;
  const [destinationMode, setDestinationMode] = useState<"new" | "existing">(
    defaultTargetPlaylistId && hasExistingPlaylists ? "existing" : "new"
  );
  const [targetPlaylistId, setTargetPlaylistId] = useState<string>(
    defaultTargetPlaylistId ?? playlists[0]?.id ?? ""
  );
  const [newName, setNewName] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const autoResolvedInitialRef = useRef<boolean>(false);
  const detectedPlaylist = parsePlaylistUrl(urlInput);

  const resolveUrl = useCallback(
    async (rawUrl: string) => {
      const parsed = parsePlaylistUrl(rawUrl);
      if (!parsed) {
        setErrorMessage(m.guided.playlists.errInvalidPlaylistUrl);
        return;
      }

      setIsResolving(true);
      setErrorMessage(null);
      try {
        const response = await fetch("/api/playlists/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: parsed.canonicalUrl }),
        });

        const data = (await response.json()) as {
          playlist?: ResolvedExternalPlaylist;
          error?: string;
        };

        if (!response.ok || !data.playlist) {
          setResolved(null);
          setErrorMessage(data.error ?? m.guided.playlists.errResolvePlaylist);
          return;
        }

        setResolved(data.playlist);
        setSelectedIds(
          new Set(data.playlist.tracks.map((track) => track.externalId))
        );
        setNewName(data.playlist.title.slice(0, MAX_PLAYLIST_NAME_LENGTH));
      } catch {
        setResolved(null);
        setErrorMessage(m.guided.playlists.errResolvePlaylist);
      } finally {
        setIsResolving(false);
      }
    },
    [
      m.guided.playlists.errInvalidPlaylistUrl,
      m.guided.playlists.errResolvePlaylist,
    ]
  );

  // Auto-resolve once when opened with a pre-filled playlist URL
  useEffect(() => {
    if (!initialUrl || autoResolvedInitialRef.current) return;
    if (!parsePlaylistUrl(initialUrl)) return;
    autoResolvedInitialRef.current = true;
    queueMicrotask(() => {
      void resolveUrl(initialUrl);
    });
  }, [initialUrl, resolveUrl]);

  const handleToggleTrack = (externalId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  };

  const handleImportSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resolved) return;

    const chosenTracks = resolved.tracks.filter((track) =>
      selectedIds.has(track.externalId)
    );
    if (chosenTracks.length === 0) {
      setErrorMessage(m.guided.playlists.errSelectTracks);
      return;
    }

    if (destinationMode === "new" && !newName.trim()) {
      setErrorMessage(m.guided.playlists.errEmptyName);
      return;
    }

    const effectiveTargetId =
      destinationMode === "existing"
        ? targetPlaylistId || playlists[0]?.id || ""
        : undefined;

    if (destinationMode === "existing" && !effectiveTargetId) {
      setErrorMessage(m.guided.playlists.errSelectPlaylist);
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: destinationMode,
          ...(destinationMode === "new"
            ? {
                name: newName.trim(),
                description: newDescription.trim() || null,
              }
            : { playlistId: effectiveTargetId }),
          tracks: chosenTracks,
        }),
      });

      const data = (await response.json()) as Partial<ImportedPlaylistPayloadResult> & {
        error?: string;
      };

      if (!response.ok || !data.playlist || !Array.isArray(data.tracks)) {
        setErrorMessage(data.error ?? m.guided.playlists.errImportPlaylist);
        return;
      }

      onImported({
        playlist: data.playlist,
        tracks: data.tracks,
        addedCount: data.addedCount ?? chosenTracks.length,
        skippedDuplicateCount: data.skippedDuplicateCount ?? 0,
        skippedCapCount: data.skippedCapCount ?? 0,
      });
    } catch {
      setErrorMessage(m.guided.playlists.errImportPlaylist);
    } finally {
      setIsImporting(false);
    }
  };

  const selectedCount = resolved
    ? resolved.tracks.filter((t) => selectedIds.has(t.externalId)).length
    : 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] p-4 shadow-xs dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListMusic className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {m.guided.playlists.importTitle}
          </h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={m.common.cancel}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Step 1: URL input + resolve */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="playlist-import-url"
            className="text-xs font-medium text-[var(--foreground)]"
          >
            {m.guided.playlists.importUrlLabel}
          </label>
          {detectedPlaylist && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
              {m.guided.providers[detectedPlaylist.provider]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex flex-1 items-center">
            <Link2 className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--foreground-muted)]" />
            <input
              id="playlist-import-url"
              type="url"
              placeholder={m.guided.playlists.importUrlPlaceholder}
              value={urlInput}
              onChange={(event) => {
                setUrlInput(event.target.value);
                setErrorMessage(null);
              }}
              className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] pr-3 pl-9 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
            />
          </div>
          <button
            type="button"
            onClick={() => void resolveUrl(urlInput)}
            disabled={isResolving || !urlInput.trim()}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
          >
            {isResolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {isResolving
              ? m.guided.playlists.resolving
              : m.guided.playlists.resolveButton}
          </button>
        </div>
      </div>

      {/* Step 2: Resolved preview + destination choice */}
      {resolved && (
        <form onSubmit={handleImportSubmit} className="flex flex-col gap-3">
          {resolved.truncated && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--warm-amber)]/30 bg-[var(--warm-amber)]/10 px-3 py-2 text-xs text-[var(--foreground)]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warm-amber)]" />
              <span>
                {m.guided.playlists.truncatedNotice(
                  resolved.limit,
                  resolved.totalCount
                )}
              </span>
            </div>
          )}

          {/* Destination Mode Question */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[var(--foreground)]">
              {m.guided.playlists.importDestinationLabel}
            </span>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[var(--surface-muted)] p-1">
              <button
                type="button"
                onClick={() => setDestinationMode("new")}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  destinationMode === "new"
                    ? "bg-[var(--surface)] text-[var(--foreground)] shadow-2xs"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {m.guided.playlists.importModeNew}
              </button>
              <button
                type="button"
                disabled={!hasExistingPlaylists}
                onClick={() => setDestinationMode("existing")}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                  destinationMode === "existing"
                    ? "bg-[var(--surface)] text-[var(--foreground)] shadow-2xs"
                    : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {m.guided.playlists.importModeExisting}
              </button>
            </div>

            {destinationMode === "new" ? (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  maxLength={MAX_PLAYLIST_NAME_LENGTH}
                  required
                  placeholder={m.guided.playlists.namePlaceholder}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
                />
                <input
                  type="text"
                  maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
                  placeholder={m.guided.playlists.descriptionPlaceholder}
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
                />
              </div>
            ) : (
              <select
                value={targetPlaylistId || playlists[0]?.id || ""}
                onChange={(event) => setTargetPlaylistId(event.target.value)}
                aria-label={m.guided.playlists.selectExistingPlaylist}
                className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
              >
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name} ({m.guided.playlists.trackCount(playlist.trackIds.length)})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selectable Tracks Preview */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] text-[var(--foreground-muted)]">
              <span>
                {m.guided.playlists.selectedTracksSummary(
                  selectedCount,
                  resolved.tracks.length
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds(
                      new Set(resolved.tracks.map((track) => track.externalId))
                    )
                  }
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  {m.guided.playlists.selectAll}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                >
                  {m.guided.playlists.deselectAll}
                </button>
              </div>
            </div>

            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl border border-black/6 bg-[var(--background)] p-1.5 dark:border-white/10">
              {resolved.tracks.map((track, idx) => {
                const checked = selectedIds.has(track.externalId);
                return (
                  <li key={track.externalId}>
                    <button
                      type="button"
                      onClick={() => handleToggleTrack(track.externalId)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        checked
                          ? "bg-[var(--accent-soft)]/60"
                          : "opacity-60 hover:opacity-90"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                            : "border-black/20 dark:border-white/25"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-muted)] text-[var(--foreground-muted)]">
                        {track.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={track.thumbnailUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Music2 className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--foreground)]">
                          {idx + 1}. {track.title}
                        </p>
                        {track.author && (
                          <p className="truncate text-[10px] text-[var(--foreground-muted)]">
                            {track.author}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <button
            type="submit"
            disabled={isImporting || selectedCount === 0}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {m.guided.playlists.importing}
              </>
            ) : destinationMode === "new" ? (
              m.guided.playlists.importConfirmNew(selectedCount)
            ) : (
              m.guided.playlists.importConfirmExisting(selectedCount)
            )}
          </button>
        </form>
      )}

      {errorMessage && (
        <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
