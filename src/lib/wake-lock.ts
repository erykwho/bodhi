"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps the device screen awake while `enabled` is true using the Screen Wake Lock API.
 * Gracefully degrades on unsupported browsers and re-acquires when returning to the tab.
 */
export function useWakeLock(enabled: boolean): { isActive: boolean } {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const releaseLock = async () => {
      const current = sentinelRef.current;
      sentinelRef.current = null;
      if (current && !current.released) {
        try {
          await current.release();
        } catch {
          // Ignore release failures when already released by the browser
        }
      }
      if (!cancelled) {
        setIsActive(false);
      }
    };

    const requestLock = async () => {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
        return;
      }

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        setIsActive(true);
        sentinel.addEventListener("release", () => {
          if (!cancelled) {
            setIsActive(false);
          }
        });
      } catch {
        // Wake lock can be rejected on low battery or unsupported contexts
        if (!cancelled) {
          setIsActive(false);
        }
      }
    };

    if (enabled) {
      void requestLock();
    } else {
      void releaseLock();
    }

    const handleVisibilityChange = () => {
      if (enabled && document.visibilityState === "visible") {
        void requestLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseLock();
    };
  }, [enabled]);

  return { isActive };
}
