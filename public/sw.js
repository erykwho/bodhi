const CACHE_NAME = "bodhi-offline-v7";
const USER_AUDIO_CACHE_NAME = "bodhi-user-audio-v1";

const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/favicon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/audio/breath-inhale-short.mp3",
  "/audio/breath-exhale-short.mp3",
  "/audio/breath-inhale-medium.mp3",
  "/audio/breath-exhale-medium.mp3",
  "/audio/breath-inhale-long.mp3",
  "/audio/breath-exhale-long.mp3",
  "/audio/bells/singing-bowl.mp3",
  "/audio/bells/tibetan-healing-bowl.mp3",
  "/audio/bells/deep-gong.mp3",
  "/audio/bells/soft-chime.mp3",
  "/audio/bells/crystal-bowl.mp3",
  "/audio/bells/wood-block.mp3",
  "/audio/ambient/gentle-rain.mp3",
  "/audio/ambient/ocean-waves.mp3",
];

async function respondWithRangeSupport(request, fullResponse) {
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    return fullResponse;
  }

  const buffer = await fullResponse.arrayBuffer();
  const total = buffer.byteLength;
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) {
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": fullResponse.headers.get("Content-Type") || "audio/mpeg",
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const start = Math.min(Number.parseInt(match[1], 10), Math.max(0, total - 1));
  const rawEnd = match[2] ? Number.parseInt(match[2], 10) : total - 1;
  const end = Math.min(Math.max(start, rawEnd), Math.max(0, total - 1));
  const slice = buffer.slice(start, end + 1);

  return new Response(slice, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": fullResponse.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(slice.byteLength),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        // Ignore individual precache failures; runtime caching will populate assets
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("bodhi-") &&
                key !== CACHE_NAME &&
                key !== USER_AUDIO_CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept API or Auth routes — keep them strictly network-only
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigation requests (HTML shell): Network-First with cached "/" fallback for Airplane Mode
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request)) || (await caches.match("/"));
          if (cached) return cached;
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        })
    );
    return;
  }

  // Local audio samples: Cache-First with HTTP 206 Range support (required for iOS Safari offline <audio>)
  if (url.origin === self.location.origin && url.pathname.startsWith("/audio/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        let fullResponse = await cache.match(url.pathname);
        if (!fullResponse) {
          const networkResponse = await fetch(url.pathname);
          if (networkResponse.ok) {
            await cache.put(url.pathname, networkResponse.clone());
          }
          fullResponse = networkResponse;
        }
        return respondWithRangeSupport(request, fullResponse.clone());
      })()
    );
    return;
  }

  // Immutable Next.js build assets & local icons: Cache-First with network fill
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/favicon.ico")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Google Fonts assets: Stale-While-Revalidate so offline typography stays intact
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
  }
});
