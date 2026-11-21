"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Check,
  Headphones,
  Link2,
  Loader2,
  LogIn,
  Music2,
  Pencil,
  Play,
  Plus,
  Tag,
  Timer,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { signInWithGoogle } from "@/app/actions";
import { GuidedSessionPlayer } from "@/components/guided-session-player";
import type { SessionUserSummary } from "@/lib/auth";
import type { MeditationSessionItem } from "@/lib/history/types";
import {
  SUGGESTED_TRACK_TAGS,
  TRACK_PROVIDER_LABELS,
  normalizeTrackTags,
  parseTrackUrl,
} from "@/lib/tracks/providers";
import {
  computeTargetIndex,
  hasOrderChanged,
  reorderItems,
} from "@/lib/tracks/reorder";
import type {
  FavoriteTrackItem,
  ResolvedTrackMetadata,
} from "@/lib/tracks/types";
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
  initialTracks: FavoriteTrackItem[];
}

interface GuidedTracksProps {
  user: SessionUserSummary | null;
  authConfigured: boolean;
  initialTracks: FavoriteTrackItem[];
  isOnline?: boolean;
  onSwitchToTimer?: () => void;
  onSessionActiveChange: (active: boolean) => void;
  onSessionSaved?: (session: MeditationSessionItem) => void;
  onSessionUpdated?: (session: MeditationSessionItem) => void;
  onReorderingChange?: (reordering: boolean) => void;
}

export function GuidedTracks({
  user,
  authConfigured,
  initialTracks,
  isOnline = true,
  onSwitchToTimer,
  onSessionActiveChange,
  onSessionSaved,
  onSessionUpdated,
  onReorderingChange,
}: GuidedTracksProps) {
  const [tracks, setTracks] = useState<FavoriteTrackItem[]>(initialTracks);
  const [activeTrack, setActiveTrack] = useState<FavoriteTrackItem | null>(
    null
  );
  const [closingBellEnabled, setClosingBellEnabled] = useState<boolean>(true);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(
    null
  );

  // Add track form state
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>("");
  const [titleInput, setTitleInput] = useState<string>("");
  const [tagsInput, setTagsInput] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState<string>("");
  const [resolvedMeta, setResolvedMeta] =
    useState<ResolvedTrackMetadata | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inline track edit state
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState<string>("");
  const [editTagsDraft, setEditTagsDraft] = useState<string[]>([]);
  const [editCustomTagDraft, setEditCustomTagDraft] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Drag-to-reorder state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);

  const tracksRef = useRef<FavoriteTrackItem[]>(tracks);
  const itemElementsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragOffsetYRef = useRef<number>(0);
  const suppressClickRef = useRef<boolean>(false);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    onSessionActiveChange(activeTrack !== null);
  }, [activeTrack, onSessionActiveChange]);

  useEffect(() => {
    onReorderingChange?.(draggingId !== null);
  }, [draggingId, onReorderingChange]);

  const detectedProvider = parseTrackUrl(urlInput)?.provider ?? null;

  const availableTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const track of tracks) {
      for (const tag of track.tags ?? []) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, tag);
        }
      }
    }
    return Array.from(seen.values());
  }, [tracks]);

  const displayedTracks = useMemo(() => {
    if (!selectedTagFilter) return tracks;
    const target = selectedTagFilter.toLowerCase();
    return tracks.filter((track) =>
      (track.tags ?? []).some((tag) => tag.toLowerCase() === target)
    );
  }, [selectedTagFilter, tracks]);

  const resetForm = useCallback(() => {
    setUrlInput("");
    setTitleInput("");
    setTagsInput([]);
    setCustomTagInput("");
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
          "Paste a valid YouTube, SoundCloud, or direct audio (.mp3/.m4a) URL."
        );
        return;
      }

      const finalTags = normalizeTrackTags(
        customTagInput.trim() ? [...tagsInput, customTagInput] : tagsInput
      );

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
            tags: finalTags,
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
        setTracks((prev) => {
          const exists = prev.some((item) => item.id === savedTrack.id);
          if (exists) {
            return prev.map((item) =>
              item.id === savedTrack.id ? savedTrack : item
            );
          }
          return [...prev, savedTrack];
        });
        resetForm();
      } catch {
        setErrorMessage("Failed to save favorite track.");
      } finally {
        setIsSaving(false);
      }
    },
    [customTagInput, resetForm, resolvedMeta, tagsInput, titleInput, urlInput]
  );

  const startEditingTrack = useCallback((track: FavoriteTrackItem) => {
    setEditingTrackId(track.id);
    setEditTitleDraft(track.title);
    setEditTagsDraft(track.tags ?? []);
    setEditCustomTagDraft("");
    setErrorMessage(null);
  }, []);

  const cancelEditingTrack = useCallback(() => {
    setEditingTrackId(null);
    setEditTitleDraft("");
    setEditTagsDraft([]);
    setEditCustomTagDraft("");
  }, []);

  const handleSaveTrackEdit = useCallback(
    async (id: string) => {
      const trimmedTitle = editTitleDraft.trim();
      if (!trimmedTitle) {
        setErrorMessage("Track title cannot be empty.");
        return;
      }

      const nextTags = normalizeTrackTags(
        editCustomTagDraft.trim()
          ? [...editTagsDraft, editCustomTagDraft]
          : editTagsDraft
      );

      setIsSavingEdit(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/tracks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmedTitle,
            tags: nextTags,
          }),
        });

        const data = (await response.json()) as {
          track?: FavoriteTrackItem;
          error?: string;
        };

        if (!response.ok || !data.track) {
          setErrorMessage(data.error ?? "Failed to update track.");
          return;
        }

        const updatedTrack = data.track;
        setTracks((prev) =>
          prev.map((item) => (item.id === updatedTrack.id ? updatedTrack : item))
        );
        cancelEditingTrack();
      } catch {
        setErrorMessage("Failed to update track.");
      } finally {
        setIsSavingEdit(false);
      }
    },
    [cancelEditingTrack, editCustomTagDraft, editTagsDraft, editTitleDraft]
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

  const persistTrackOrder = useCallback(
    async (
      nextTracks: FavoriteTrackItem[],
      previousTracks: FavoriteTrackItem[]
    ) => {
      try {
        const response = await fetch("/api/tracks/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderedIds: nextTracks.map((item) => item.id),
          }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setTracks(previousTracks);
          setErrorMessage(data.error ?? "Failed to save track order.");
        }
      } catch {
        setTracks(previousTracks);
        setErrorMessage("Failed to save track order.");
      }
    },
    []
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
      const initialTracksSnapshot = session.initialTracks;
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
        setTracks(initialTracksSnapshot);
        return;
      }

      const currentTracks = tracksRef.current;
      const previousIds = initialTracksSnapshot.map((item) => item.id);
      const nextIds = currentTracks.map((item) => item.id);
      if (hasOrderChanged(previousIds, nextIds)) {
        void persistTrackOrder(currentTracks, initialTracksSnapshot);
      }
    },
    [persistTrackOrder]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      session.currentY = event.clientY;
      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      const movedDistance = Math.hypot(deltaX, deltaY);

      if (!session.active) {
        if (session.pointerType === "touch") {
          if (movedDistance > TOUCH_CANCEL_THRESHOLD_PX) {
            endDrag(false);
          }
          return;
        }

        // Mouse/pen: start dragging once pointer moves past a small threshold
        if (movedDistance >= MOUSE_DRAG_THRESHOLD_PX) {
          activateDrag(session);
        } else {
          return;
        }
      }

      const currentList = tracksRef.current;
      const currentIndex = currentList.findIndex(
        (item) => item.id === session.trackId
      );
      if (currentIndex === -1) {
        endDrag(false);
        return;
      }

      // Measure resting slot rects (compensating for the dragged card's current translateY)
      const currentOffset = dragOffsetYRef.current;
      const itemRects = currentList.map((item) => {
        const el = itemElementsRef.current.get(item.id);
        if (!el) return { top: 0, height: 0 };
        const rect = el.getBoundingClientRect();
        const isDragged = item.id === session.trackId;
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

        const reordered = reorderItems(currentList, currentIndex, targetIndex);
        tracksRef.current = reordered;
        setTracks(reordered);

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

      // Gentle edge auto-scroll when dragging near top or bottom of viewport
      const edgeThreshold = 72;
      if (event.clientY < edgeThreshold) {
        window.scrollBy(0, -8);
      } else if (event.clientY > window.innerHeight - edgeThreshold) {
        window.scrollBy(0, 8);
      }
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

  // Lock touch scrolling and text selection only while a drag is actively in progress
  useEffect(() => {
    if (draggingId === null) return;

    const preventTouchScroll = (event: TouchEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
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
      if (session?.longPressTimer !== null && session?.longPressTimer !== undefined) {
        window.clearTimeout(session.longPressTimer);
      }
      dragSessionRef.current = null;
      onReorderingChange?.(false);
    };
  }, [onReorderingChange]);

  const handleTrackPointerDown = useCallback(
    (trackId: string, event: React.PointerEvent<HTMLLIElement>) => {
      if (tracksRef.current.length < 2) return;
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
        initialTracks: [...tracksRef.current],
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
    [activateDrag]
  );

  const setTrackItemRef = useCallback(
    (trackId: string, node: HTMLLIElement | null) => {
      if (node) {
        itemElementsRef.current.set(trackId, node);
      } else {
        itemElementsRef.current.delete(trackId);
      }
    },
    []
  );

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

  if (!isOnline) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--warm-amber)]">
            <WifiOff className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
            You&apos;re Offline
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
            Guided tracks from YouTube and SoundCloud require an internet
            connection. Your Meditation Timer works completely offline.
          </p>

          {onSwitchToTimer && (
            <button
              type="button"
              onClick={onSwitchToTimer}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
            >
              <Timer className="h-4 w-4" />
              Open Meditation Timer
            </button>
          )}
        </div>
      </section>
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
              YouTube, SoundCloud, or Audio URL
            </label>
            {detectedProvider && (
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                {TRACK_PROVIDER_LABELS[detectedProvider]}
              </span>
            )}
          </div>

          <div className="relative flex items-center">
            <Link2 className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--foreground-muted)]" />
            <input
              id="track-url-input"
              type="url"
              required
              placeholder="YouTube, SoundCloud, or direct .mp3 / .m4a link"
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

          {/* Optional Tags Picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[var(--foreground)]">
              Tags (optional)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_TRACK_TAGS.map((tag) => {
                const isSelected = tagsInput.some(
                  (t) => t.toLowerCase() === tag.toLowerCase()
                );
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setTagsInput((prev) =>
                        isSelected
                          ? prev.filter(
                              (t) => t.toLowerCase() !== tag.toLowerCase()
                            )
                          : normalizeTrackTags([...prev, tag])
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                        : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              maxLength={24}
              placeholder="Add custom tag..."
              value={customTagInput}
              onChange={(event) => setCustomTagInput(event.target.value)}
              className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]/70 focus:border-[var(--accent)] dark:border-white/12"
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

      {/* Single-row Tag Filter Bar (only when tags exist) */}
      {availableTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setSelectedTagFilter(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
              selectedTagFilter === null
                ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                : "border border-black/6 bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] dark:border-white/10"
            }`}
          >
            All
          </button>
          {availableTags.map((tag) => {
            const isSelected =
              selectedTagFilter?.toLowerCase() === tag.toLowerCase();
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTagFilter(isSelected ? null : tag)}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                    : "border border-black/6 bg-[var(--surface)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] dark:border-white/10"
                }`}
              >
                <Tag className="h-2.5 w-2.5 opacity-75" />
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Favorite Tracks List */}
      {displayedTracks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-black/12 bg-[var(--surface)]/60 px-6 py-12 text-center dark:border-white/12">
          <Music2 className="h-7 w-7 text-[var(--foreground-muted)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
            {tracks.length === 0
              ? "No favorite tracks yet"
              : "No tracks match this tag"}
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--foreground-muted)]">
            {tracks.length === 0
              ? 'Tap "Add Track" to save a YouTube, SoundCloud, or direct audio (.mp3/.m4a) guided meditation.'
              : "Choose another tag or tap All to see all favorites."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2.5">
            {displayedTracks.map((track) => {
              const isDragged = draggingId === track.id;
              const isEditing = editingTrackId === track.id;
              const canDrag =
                selectedTagFilter === null &&
                editingTrackId === null &&
                tracks.length >= 2;

              return (
                <li
                  key={track.id}
                  ref={(node) => setTrackItemRef(track.id, node)}
                  onPointerDown={(event) => {
                    if (!canDrag) return;
                    handleTrackPointerDown(track.id, event);
                  }}
                  onContextMenu={(event) => {
                    if (canDrag) {
                      event.preventDefault();
                    }
                  }}
                  style={
                    isDragged
                      ? {
                          transform: `translate3d(0, ${dragOffsetY}px, 0) scale(1.02)`,
                        }
                      : undefined
                  }
                  className={cn(
                    "relative flex flex-col gap-2.5 rounded-2xl border border-black/6 bg-[var(--surface)] p-3 shadow-xs transition-colors dark:border-white/10",
                    !isEditing && "select-none",
                    isDragged
                      ? "z-20 cursor-grabbing border-[var(--accent)]/50 shadow-lg ring-2 ring-[var(--accent)]/30"
                      : "hover:border-[var(--accent)]/35",
                    draggingId !== null && !isDragged && "opacity-85"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressClickRef.current || isEditing) return;
                        setActiveTrack(track);
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-3 text-left",
                        isDragged && "cursor-grabbing"
                      )}
                    >
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
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
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                          <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium">
                            {TRACK_PROVIDER_LABELS[track.provider]}
                          </span>
                          {track.author && (
                            <span className="truncate">{track.author}</span>
                          )}
                        </div>
                        {track.tags && track.tags.length > 0 && !isEditing && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {track.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>

                    <div
                      data-no-drag="true"
                      className="flex shrink-0 items-center gap-0.5"
                    >
                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() =>
                          isEditing
                            ? cancelEditingTrack()
                            : startEditingTrack(track)
                        }
                        aria-label={`Edit ${track.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                      >
                        {isEditing ? (
                          <X className="h-3.5 w-3.5" />
                        ) : (
                          <Pencil className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        data-no-drag="true"
                        onClick={() => void handleDeleteTrack(track.id)}
                        disabled={deletingId === track.id}
                        aria-label={`Remove ${track.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--foreground-muted)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                      >
                        {deletingId === track.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Inline Title & Tags Editor */}
                  {isEditing && (
                    <div
                      data-no-drag="true"
                      className="flex flex-col gap-2.5 border-t border-black/6 pt-2.5 dark:border-white/10"
                    >
                      <input
                        type="text"
                        maxLength={160}
                        value={editTitleDraft}
                        onChange={(event) =>
                          setEditTitleDraft(event.target.value)
                        }
                        placeholder="Track title"
                        className="h-9 w-full rounded-xl border border-black/10 bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
                      />

                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(
                          new Set([...SUGGESTED_TRACK_TAGS, ...editTagsDraft])
                        ).map((tag) => {
                          const isSelected = editTagsDraft.some(
                            (t) => t.toLowerCase() === tag.toLowerCase()
                          );
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setEditTagsDraft((prev) =>
                                  isSelected
                                    ? prev.filter(
                                        (t) =>
                                          t.toLowerCase() !== tag.toLowerCase()
                                      )
                                    : normalizeTrackTags([...prev, tag])
                                )
                              }
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                                isSelected
                                  ? "bg-[var(--accent)] text-[#fcfaf6] dark:text-[#151917]"
                                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={24}
                          placeholder="Add custom tag..."
                          value={editCustomTagDraft}
                          onChange={(event) =>
                            setEditCustomTagDraft(event.target.value)
                          }
                          className="h-8 min-w-0 flex-1 rounded-xl border border-black/10 bg-[var(--background)] px-2.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/12"
                        />
                        <button
                          type="button"
                          onClick={cancelEditingTrack}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveTrackEdit(track.id)}
                          disabled={isSavingEdit || !editTitleDraft.trim()}
                          className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#fcfaf6] disabled:opacity-50 dark:text-[#151917]"
                        >
                          {isSavingEdit ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {selectedTagFilter === null && tracks.length >= 2 && (
            <p className="pt-1 text-center text-[11px] text-[var(--foreground-muted)]/75">
              Hold and drag to reorder
            </p>
          )}
        </div>
      )}
    </section>
  );
}
