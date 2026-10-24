import { useSyncExternalStore } from "react";

/**
 * New releases of Tally arrive through the service worker. A downloaded release waits until the
 * user chooses Reload, so an open tab never runs a mix of old and new code. IndexedDB data is
 * untouched by an update; only the app files change.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const setWaiting = (w: ServiceWorker | null) => { waiting = w; listeners.forEach((l) => l()); };

export function useUpdateReady(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => waiting !== null);
}

let reloadRequested = false;

export function applyUpdate() {
  if (!waiting) return;
  reloadRequested = true;
  waiting.postMessage("SKIP_WAITING");
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  // Reload only when the user asked for the update. The first install also changes the controller.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const watch = (w: ServiceWorker) => w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
      });
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      if (reg.installing) watch(reg.installing);
      reg.addEventListener("updatefound", () => { if (reg.installing) watch(reg.installing); });

      // Long-lived tabs and Home Screen apps: look for a new release when the user comes back.
      let lastCheck = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && Date.now() - lastCheck > CHECK_EVERY_MS) {
          lastCheck = Date.now();
          reg.update().catch(() => {});
        }
      });
    } catch {
      // Offline support is a bonus; the app works without it.
    }
  });
}
