"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  ListMusic,
  Loader2,
  Music2,
  Pencil,
  Play,
  Plus,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import {
  PlaylistImportPanel,
  type ImportedPlaylistPayloadResult,
} from "@/components/playlist-import-panel";
import {
  formatBytesLabel,
  saveTrackAudioOffline,
  type SavedOfflineAudioMeta,
} from "@/lib/offline/audio-cache";
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  filterOfflinePlayablePlaylistTracks,
  getEligibleOfflineDownloadTracks,
  getPlaylistCoverThumbnail,
  resolvePlaylistTracks,
} from "@/lib/tracks/playlists";
import { isAudioStreamProvider } from "@/lib/tracks/providers";
import {
  computeTargetIndex,
  hasOrderChanged,
  reorderItems,
} from "@/lib/tracks/reorder";
import type { FavoriteTrackItem, TrackPlaylistItem } from "@/lib/tracks/types";
import { cn } from "@/lib/utils";

const LONG_PRESS_DELAY_MS = 250;
const TOUCH_CANCEL_THRESHOLD_PX = 8;
const MOUSE_DRAG_THRESHOLD_PX = 6;

interface DragSession {
  pointerId: number;
  pointerType: string;
  trackId: string;
  startX: number;
  startY: number;
  anchorY: number;
  currentY: number;
  active: boolean;
  longPressTimer: number | null;
  initialIds: string[];
}

interface PlaylistDetailViewProps {
  playlist: TrackPlaylistItem;
  allTracks: FavoriteTrackItem[];
  playlists: TrackPlaylistItem[];
  savedAudio: Record<string, SavedOfflineAudioMeta>;
  isOnline: boolean;
  isAuthenticated: boolean;
  onBack: () => void;
  onPlayQueue: (queue: FavoriteTrackItem[], startIndex: number) => void;
  onPlaylistUpdated: (playlist: TrackPlaylistItem) => void;
  onPlaylistDeleted: (playlistId: string) => void;
  onImportResult: (result: ImportedPlaylistPayloadResult) => void;
  onReorderingChange?: (reordering: boolean) => void;
}

export function PlaylistDetailView({
  playlist,
  allTracks,
  playlists,
  savedAudio,
  isOnline,
  isAuthenticated,
  onBack,
  onPlayQueue,
  onPlaylistUpdated,
  onPlaylistDeleted,
  onImportResult,
  onReorderingChange,
}: PlaylistDetailViewProps) {
  const { m } = useI18n();

  const [isEditingMeta, setIsEditingMeta] = useState<boolean>(false);
  const [nameDraft, setNameDraft] = useState<string>(playlist.name);
  const [descDraft, setDescDraft] = useState<string>(playlist.description ?? "");
  const [isSavingMeta, setIsSavingMeta] = useState<boolean>(false);

  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const [isAddingLibrary, setIsAddingLibrary] = useState<boolean>(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(
    new Set()
  );
  const [isAddingTracks, setIsAddingTracks] = useState<boolean>(false);

  const [isImportingIntoThis, setIsImportingIntoThis] =
    useState<boolean>(false);

  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Drag-to-reorder state (free custom playlist order)
  const [localOrderedIds, setLocalOrderedIds] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);

  const effectiveTrackIds = localOrderedIds ?? playlist.trackIds;
  const effectivePlaylist = useMemo(
    () => ({ ...playlist, trackIds: effectiveTrackIds }),
    [effectiveTrackIds, playlist]
  );

  const playlistTracks = useMemo(
    () => resolvePlaylistTracks(effectivePlaylist, allTracks),
    [allTracks, effectivePlaylist]
  );

  const offlinePlayableTracks = useMemo(
    () =>
      filterOfflinePlayablePlaylistTracks(
        effectivePlaylist,
        allTracks,
        savedAudio
      ),
    [allTracks, effectivePlaylist, savedAudio]
  );

  const eligibleDownloads = useMemo(
    () =>
      getEligibleOfflineDownloadTracks(
        effectivePlaylist,
        allTracks,
        savedAudio
      ),
    [allTracks, effectivePlaylist, savedAudio]
  );

  const hasAnyStreamTracks = useMemo(
    () => playlistTracks.some((track) => isAudioStreamProvider(track.provider)),
    [playlistTracks]
  );

  const coverThumbnail = useMemo(
    () => getPlaylistCoverThumbnail(effectivePlaylist, allTracks),
    [allTracks, effectivePlaylist]
  );

  const availableLibraryTracks = useMemo(() => {
    const existingSet = new Set(playlist.trackIds);
    return allTracks.filter((track) => !existingSet.has(track.id));
  }, [allTracks, playlist.trackIds]);

  const orderedIdsRef = useRef<string[]>(
    playlistTracks.map((track) => track.id)
  );
  const itemElementsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragOffsetYRef = useRef<number>(0);
  const suppressClickRef = useRef<boolean>(false);

  useEffect(() => {
    orderedIdsRef.current = playlistTracks.map((track) => track.id);
  }, [playlistTracks]);

  useEffect(() => {
    onReorderingChange?.(draggingId !== null);
  }, [draggingId, onReorderingChange]);

  const persistOrder = useCallback(
    async (nextIds: string[]) => {
      try {
        const response = await fetch(
          `/api/playlists/${encodeURIComponent(playlist.id)}/reorder`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderedTrackIds: nextIds }),
          }
        );

        const data = (await response.json()) as {
          playlist?: TrackPlaylistItem;
          error?: string;
        };

        if (!response.ok || !data.playlist) {
          setLocalOrderedIds(null);
          setErrorMessage(data.error ?? m.guided.playlists.errReorderPlaylist);
          return;
        }

        setLocalOrderedIds(null);
        onPlaylistUpdated(data.playlist);
      } catch {
        setLocalOrderedIds(null);
        setErrorMessage(m.guided.playlists.errReorderPlaylist);
      }
    },
    [m.guided.playlists.errReorderPlaylist, onPlaylistUpdated, playlist.id]
  );

  const activateDrag = useCallback((session: DragSession) => {
    if (session.active) return;
    session.active = true;
    session.anchorY = session.currentY;
    dragOffsetYRef.current = 0;
    setDraggingId(session.trackId);
    setDragOffsetY(0);
    setErrorMessage(null);

    if (
      session.pointerType === "touch" &&
      typeof navigator !== "undefined" &&
      "vibrate" in navigator
    ) {
      navigator.vibrate(15);
    }
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      const session = dragSessionRef.current;
      if (!session) return;

      if (session.longPressTimer !== null) {
        window.clearTimeout(session.longPressTimer);
      }

      const wasActive = session.active;
      const initialIds = session.initialIds;
      dragSessionRef.current = null;
      dragOffsetYRef.current = 0;
      setDraggingId(null);
      setDragOffsetY(0);

      if (!wasActive) return;

      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      if (!commit) {
        setLocalOrderedIds(null);
        return;
      }

      const nextIds = orderedIdsRef.current;
      if (hasOrderChanged(initialIds, nextIds)) {
        void persistOrder(nextIds);
      } else {
        setLocalOrderedIds(null);
      }
    },
    [persistOrder]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      session.currentY = event.clientY;
      const movedDistance = Math.hypot(
        event.clientX - session.startX,
        event.clientY - session.startY
      );

      if (!session.active) {
        if (session.pointerType === "touch") {
          if (movedDistance > TOUCH_CANCEL_THRESHOLD_PX) {
            endDrag(false);
          }
          return;
        }
        if (movedDistance >= MOUSE_DRAG_THRESHOLD_PX) {
          activateDrag(session);
        } else {
          return;
        }
      }

      const currentIds = orderedIdsRef.current;
      const currentIndex = currentIds.indexOf(session.trackId);
      if (currentIndex === -1) {
        endDrag(false);
        return;
      }

      const currentOffset = dragOffsetYRef.current;
      const itemRects = currentIds.map((id) => {
        const el = itemElementsRef.current.get(id);
        if (!el) return { top: 0, height: 0 };
        const rect = el.getBoundingClientRect();
        const isDragged = id === session.trackId;
        return {
          top: isDragged ? rect.top - currentOffset : rect.top,
          height: rect.height,
        };
      });

      const targetIndex = computeTargetIndex(
        event.clientY,
        itemRects,
        currentIndex
      );

      if (targetIndex !== currentIndex) {
        const slotDelta =
          itemRects[targetIndex].top - itemRects[currentIndex].top;
        session.anchorY += slotDelta;

        const reordered = reorderItems(currentIds, currentIndex, targetIndex);
        orderedIdsRef.current = reordered;
        setLocalOrderedIds(reordered);

        if (
          session.pointerType === "touch" &&
          typeof navigator !== "undefined" &&
          "vibrate" in navigator
        ) {
          navigator.vibrate(5);
        }
      }

      const nextOffset = event.clientY - session.anchorY;
      dragOffsetYRef.current = nextOffset;
      setDragOffsetY(nextOffset);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      endDrag(true);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      endDrag(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [activateDrag, endDrag]);

  useEffect(() => {
    if (draggingId === null) return;
    const preventTouchScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const preventSelect = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener("touchmove", preventTouchScroll, {
      passive: false,
    });
    window.addEventListener("selectstart", preventSelect);
    return () => {
      window.removeEventListener("touchmove", preventTouchScroll);
      window.removeEventListener("selectstart", preventSelect);
    };
  }, [draggingId]);

  useEffect(() => {
    return () => {
      const session = dragSessionRef.current;
      if (session?.longPressTimer != null) {
        window.clearTimeout(session.longPressTimer);
      }
      dragSessionRef.current = null;
      onReorderingChange?.(false);
    };
  }, [onReorderingChange]);

  const handleTrackPointerDown = useCallback(
    (trackId: string, event: React.PointerEvent<HTMLLIElement>) => {
      if (!isOnline || orderedIdsRef.current.length < 2) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-no-drag='true']")
      ) {
        return;
      }

      if (dragSessionRef.current?.longPressTimer != null) {
        window.clearTimeout(dragSessionRef.current.longPressTimer);
      }

      const session: DragSession = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        trackId,
        startX: event.clientX,
        startY: event.clientY,
        anchorY: event.clientY,
        currentY: event.clientY,
        active: false,
        longPressTimer: null,
        initialIds: [...orderedIdsRef.current],
      };

      if (event.pointerType === "touch") {
        session.longPressTimer = window.setTimeout(() => {
          if (dragSessionRef.current === session) {
            activateDrag(session);
          }
        }, LONG_PRESS_DELAY_MS);
      }

      dragSessionRef.current = session;
    },
    [activateDrag, isOnline]
  );

  const handleSaveMeta = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      setErrorMessage(m.guided.playlists.errEmptyName);
      return;
    }

    setIsSavingMeta(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlist.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: descDraft.trim() || null,
          }),
        }
      );

      const data = (await response.json()) as {
        playlist?: TrackPlaylistItem;
        error?: string;
      };

      if (!response.ok || !data.playlist) {
        setErrorMessage(data.error ?? m.guided.playlists.errUpdatePlaylist);
        return;
      }

      onPlaylistUpdated(data.playlist);
      setIsEditingMeta(false);
    } catch {
      setErrorMessage(m.guided.playlists.errUpdatePlaylist);
    } finally {
      setIsSavingMeta(false);
    }
  };

  const handleDeletePlaylist = async () => {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlist.id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setErrorMessage(data.error ?? m.guided.playlists.errDeletePlaylist);
        return;
      }
      onPlaylistDeleted(playlist.id);
    } catch {
      setErrorMessage(m.guided.playlists.errDeletePlaylist);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddSelectedLibraryTracks = async () => {
    const ids = Array.from(selectedLibraryIds);
    if (ids.length === 0) return;

    setIsAddingTracks(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlist.id)}/tracks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackIds: ids }),
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
      setSelectedLibraryIds(new Set());
      setIsAddingLibrary(false);
    } catch {
      setErrorMessage(m.guided.playlists.errModifyTracks);
    } finally {
      setIsAddingTracks(false);
    }
  };

  const handleRemoveTrack = async (trackId: string) => {
    setRemovingTrackId(trackId);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlist.id)}/tracks/${encodeURIComponent(trackId)}`,
        { method: "DELETE" }
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
      setRemovingTrackId(null);
    }
  };

  const handleBatchDownloadOffline = async () => {
    if (!isOnline || eligibleDownloads.length === 0 || batchProgress) return;
    setErrorMessage(null);
    const targets = [...eligibleDownloads];
    let failedCount = 0;

    for (let i = 0; i < targets.length; i++) {
      setBatchProgress({ current: i + 1, total: targets.length });
      try {
        await saveTrackAudioOffline(targets[i], isAuthenticated);
      } catch {
        failedCount += 1;
      }
    }

    setBatchProgress(null);
    if (failedCount > 0) {
      setErrorMessage(m.guided.errOfflineDownload);
    }
  };

  const playableQueue = isOnline ? playlistTracks : offlinePlayableTracks;
  const canDrag = isOnline && playlistTracks.length >= 2 && !isEditingMeta;

  return (
    <section className="flex flex-1 flex-col gap-3.5 py-1">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {m.guided.playlists.backToPlaylists}
        </button>

        {isOnline && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setNameDraft(playlist.name);
                setDescDraft(playlist.description ?? "");
                setIsEditingMeta((prev) => !prev);
                setConfirmingDelete(false);
              }}
              aria-label={m.guided.playlists.editPlaylist}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/8 bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
            >
              {isEditingMeta ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete((prev) => !prev);
                setIsEditingMeta(false);
              }}
              aria-label={m.guided.playlists.deletePlaylist}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/8 bg-[var(--surface)] text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 dark:border-white/10 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Bar */}
      {confirmingDelete && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-red-500/25 bg-red-500/8 p-3.5">
          <p className="text-xs leading-relaxed text-[var(--foreground)]">
            {m.guided.playlists.deleteConfirm}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            >
              {m.common.cancel}
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => void handleDeletePlaylist()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
              {m.common.delete}
            </button>
          </div>
        </div>
      )}

      {/* Header Card */}
      <div className="flex flex-col gap-3 rounded-2xl border border-black/6 bg-[var(--surface)] p-4 shadow-xs dark:border-white/10">
        {isEditingMeta ? (
          <form onSubmit={handleSaveMeta} className="flex flex-col gap-2.5">
            <input
              type="text"
              maxLength={MAX_PLAYLIST_NAME_LENGTH}
              required
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder={m.guided.playlists.namePlaceholder}
              className="h-10 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-sm font-medium text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
            />
            <input
              type="text"
              maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
              value={descDraft}
              onChange={(event) => setDescDraft(event.target.value)}
              placeholder={m.guided.playlists.descriptionPlaceholder}
              className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditingMeta(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                {m.common.cancel}
              </button>
              <button
                type="submit"
                disabled={isSavingMeta || !nameDraft.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[#fcfaf6] disabled:opacity-50 dark:text-[#151917]"
              >
                {isSavingMeta ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {m.common.save}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              {coverThumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverThumbnail}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <ListMusic className="h-6 w-6" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold tracking-tight text-[var(--foreground)]">
                {playlist.name}
              </h2>
              {playlist.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--foreground-muted)]">
                  {playlist.description}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--foreground-muted)]">
                <span>{m.guided.playlists.trackCount(playlistTracks.length)}</span>
                {hasAnyStreamTracks && eligibleDownloads.length === 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {m.guided.playlists.allEligibleOffline}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Action Row */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={playableQueue.length === 0}
            onClick={() => onPlayQueue(playableQueue, 0)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-45 dark:text-[#151917]"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {m.guided.playlists.playFromStart}
          </button>

          {isOnline && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsAddingLibrary((prev) => !prev);
                  setIsImportingIntoThis(false);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/8 bg-[var(--background)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
              >
                <Plus className="h-3.5 w-3.5" />
                {m.guided.playlists.addTracks}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsImportingIntoThis((prev) => !prev);
                  setIsAddingLibrary(false);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/8 bg-[var(--background)] px-3 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] dark:border-white/10"
              >
                <Download className="h-3.5 w-3.5" />
                {m.guided.playlists.importPlaylist}
              </button>

              {eligibleDownloads.length > 0 && (
                <button
                  type="button"
                  disabled={batchProgress !== null}
                  onClick={() => void handleBatchDownloadOffline()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)]/70 px-3 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-60"
                >
                  {batchProgress ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {m.guided.playlists.downloadingBatch(
                        batchProgress.current,
                        batchProgress.total
                      )}
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      {m.guided.playlists.downloadOfflineAll(
                        eligibleDownloads.length
                      )}
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Import directly into this playlist */}
      {isOnline && isImportingIntoThis && (
        <PlaylistImportPanel
          playlists={playlists}
          defaultTargetPlaylistId={playlist.id}
          onCancel={() => setIsImportingIntoThis(false)}
          onImported={(result) => {
            onImportResult(result);
            setIsImportingIntoThis(false);
          }}
        />
      )}

      {/* Multi-select library track picker */}
      {isOnline && isAddingLibrary && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-black/6 bg-[var(--surface)] p-3.5 shadow-xs dark:border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--foreground)]">
              {m.guided.playlists.addTracksTitle}
            </span>
            <button
              type="button"
              onClick={() => setIsAddingLibrary(false)}
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {availableLibraryTracks.length === 0 ? (
            <p className="py-2 text-xs text-[var(--foreground-muted)]">
              {allTracks.length === 0
                ? m.guided.playlists.noLibraryTracksToAdd
                : m.guided.playlists.allLibraryTracksAdded}
            </p>
          ) : (
            <>
              <ul className="flex max-h-52 flex-col gap-1 overflow-y-auto">
                {availableLibraryTracks.map((track) => {
                  const selected = selectedLibraryIds.has(track.id);
                  return (
                    <li key={track.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedLibraryIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(track.id)) next.delete(track.id);
                            else next.add(track.id);
                            return next;
                          })
                        }
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                          selected
                            ? "bg-[var(--accent-soft)]"
                            : "bg-[var(--background)] hover:bg-[var(--surface-muted)]"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            selected
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                              : "border-black/20 dark:border-white/25"
                          }`}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[var(--foreground)]">
                            {track.title}
                          </p>
                          <p className="truncate text-[10px] text-[var(--foreground-muted)]">
                            {m.guided.providers[track.provider]}
                            {track.author ? ` · ${track.author}` : ""}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={isAddingTracks || selectedLibraryIds.size === 0}
                onClick={() => void handleAddSelectedLibraryTracks()}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#151917]"
              >
                {isAddingTracks ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {m.guided.playlists.addSelectedTracks(selectedLibraryIds.size)}
              </button>
            </>
          )}
        </div>
      )}

      {errorMessage && (
        <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}

      {/* Playlist Tracks List */}
      {playlistTracks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-black/12 bg-[var(--surface)]/60 px-6 py-12 text-center dark:border-white/12">
          <ListMusic className="h-7 w-7 text-[var(--foreground-muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
            {m.guided.playlists.emptyPlaylistTitle}
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
            {m.guided.playlists.emptyPlaylistBody}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {playlistTracks.map((track, idx) => {
              const isDragged = draggingId === track.id;
              const offlineMeta = savedAudio[track.id];
              const isPlayableOffline =
                isAudioStreamProvider(track.provider) && Boolean(offlineMeta);
              const isDisabledOffline = !isOnline && !isPlayableOffline;

              return (
                <li
                  key={track.id}
                  ref={(node) => {
                    if (node) itemElementsRef.current.set(track.id, node);
                    else itemElementsRef.current.delete(track.id);
                  }}
                  onPointerDown={(event) => {
                    if (!canDrag) return;
                    handleTrackPointerDown(track.id, event);
                  }}
                  onContextMenu={(event) => {
                    if (canDrag) event.preventDefault();
                  }}
                  style={
                    isDragged
                      ? {
                          transform: `translate3d(0, ${dragOffsetY}px, 0) scale(1.02)`,
                        }
                      : undefined
                  }
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-2xl border border-black/6 bg-[var(--surface)] p-3 shadow-xs transition-colors select-none dark:border-white/10",
                    isDragged
                      ? "z-20 cursor-grabbing border-[var(--accent)]/50 shadow-lg ring-2 ring-[var(--accent)]/30"
                      : "hover:border-[var(--accent)]/35",
                    draggingId !== null && !isDragged && "opacity-85",
                    isDisabledOffline && "opacity-55"
                  )}
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[11px] font-medium text-[var(--foreground-muted)]">
                    {idx + 1}
                  </span>

                  <button
                    type="button"
                    disabled={isDisabledOffline}
                    onClick={() => {
                      if (suppressClickRef.current || isDisabledOffline) return;
                      if (isOnline) {
                        onPlayQueue(playlistTracks, idx);
                      } else {
                        const offlineIdx = offlinePlayableTracks.findIndex(
                          (item) => item.id === track.id
                        );
                        if (offlineIdx >= 0) {
                          onPlayQueue(offlinePlayableTracks, offlineIdx);
                        }
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed"
                  >
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      {track.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={track.thumbnailUrl}
                          alt=""
                          draggable={false}
                          referrerPolicy="no-referrer"
                          className="pointer-events-none h-full w-full object-cover"
                        />
                      ) : (
                        <Music2 className="h-4 w-4" />
                      )}
                      {!isDisabledOffline && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {track.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                        <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">
                          {m.guided.providers[track.provider]}
                        </span>
                        {isPlayableOffline && offlineMeta && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            {m.guided.savedOfflineBadge(
                              formatBytesLabel(offlineMeta.bytes)
                            )}
                          </span>
                        )}
                        {isDisabledOffline && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warm-amber)]">
                            <WifiOff className="h-2.5 w-2.5" />
                            {m.guided.playlists.offlineUnavailableTrack}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {isOnline && (
                    <button
                      type="button"
                      data-no-drag="true"
                      disabled={removingTrackId === track.id}
                      onClick={() => void handleRemoveTrack(track.id)}
                      aria-label={m.guided.playlists.removeTrackAria(
                        track.title
                      )}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                    >
                      {removingTrackId === track.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {canDrag && (
            <p className="pt-1 text-center text-[11px] text-[var(--foreground-muted)]/75">
              {m.guided.holdAndDrag}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
