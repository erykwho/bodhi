"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getClientSnapshot(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

/**
 * Tracks browser online/offline state reactively via useSyncExternalStore.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
