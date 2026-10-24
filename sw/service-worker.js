// Tally service worker. The build fills in VERSION and PRECACHE below (see vite.config.ts).
// - Every file of a release is cached on install, so the app works fully offline.
// - A new release waits until the page asks it to take over ("Update ready → Reload"),
//   so an open tab never mixes old and new files. Data in IndexedDB is never touched here.
const VERSION = __VERSION__;
const CACHE = `tally-${VERSION}`;
const PRECACHE = __PRECACHE__;

// The page URLs a navigation can land on, mapped to the cached copy to serve offline.
const PAGES = { "/": "/", "/index.html": "/", "/app": "/app", "/app.html": "/app", "/privacy": "/privacy", "/privacy.html": "/privacy" };

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tally-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    const page = PAGES[url.pathname] ?? "/app";
    // Network first, so an online visit always gets the deployed page; the cache covers offline.
    e.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((c) => c.match(page)).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Build assets have content hashes in their names, so the cached copy is always correct.
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok && url.pathname.startsWith("/assets/")) c.put(req, res.clone());
      return res;
    }))),
  );
});
