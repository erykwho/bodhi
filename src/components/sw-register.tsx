"use client";

import { useEffect } from "react";

/**
 * Registers the Bodhi offline Service Worker silently in production/browser environments.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (!cancelled) {
          void registration.update();
        }
      } catch {
        // Gracefully ignore SW registration failures on restricted contexts
      }
    };

    void register();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
