const CACHE_NAME = "makeable-hologram-v1";
const APP_SHELL = [
  "/hologram",
  "/hologram/",
  "/hologram/index.html",
  "/hologram/hologram.css",
  "/hologram/hologram.js",
  "/hologram/ble-client.js",
  "/hologram/ble-protocol.js",
  "/hologram/frame-codec.js",
  "/hologram/icon.svg",
  "/hologram/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/hologram/index.html"))),
  );
});

