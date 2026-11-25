/* Cold Storage service worker.
 *
 * Deliberately conservative - this app handles live stock and money:
 *  - Only static build assets and icons are cached (cache-first; _next/static is content-hashed).
 *  - Page navigations are ALWAYS network-first and are never stored, so stock figures and
 *    customer data are never served stale or kept in a shared cache.
 *  - If the network is down, a navigation shows /offline (a static page that says so).
 *  - Non-GET requests (every write) and anything cross-origin (Supabase) bypass the worker entirely,
 *    so there is no offline write queue and no silent conflict with server inventory.
 */
const VERSION = "v1";
const STATIC_CACHE = `coldstore-static-${VERSION}`;
const PRECACHE = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("coldstore-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC_CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
