/* Service worker Finwise: hanya cache tampilan, TIDAK pernah cache API/token. */
const CACHE = "finwise-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;

  const save = (key, response) => {
    event.waitUntil(
      caches.open(CACHE).then((cache) => cache.put(key, response.clone())),
    );
  };

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === "/") save("/", response);
          return response;
        })
        .catch(async () => {
          const cachedPage = (await caches.match(request)) || (await caches.match("/"));
          return cachedPage || (await caches.match(OFFLINE)) || Response.error();
        }),
    );
    return;
  }

  if (["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === "basic") save(request, response);
          return response;
        });
      }),
    );
  }
});
