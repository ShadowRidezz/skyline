// Keeps Skyline's own files on the phone so it opens instantly (and shows something without internet).
// Always asks GitHub for the newest copy first (skipping the browser's 10-minute cache), so updates show on the next open.
// Messages and everything from the Social server always come fresh from the network.
const CACHE = "skyline-1.28.2-mvbs2as6";
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll([new Request("./", { cache: "reload" }), new Request("index.html", { cache: "reload" })])).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // (the server, GIFs: always live)
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
