/* Service worker: app shell + multi-tenant-safe offline caching.
 * API GET responses are cached per-tenant (via the pharma_tid cookie) so
 * users on a shared browser never see each other's data. */

const VERSION = "pharma-v3";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const PRECACHE = [
  "/",
  "/manifest.json",
  "/icons/icon-512.png",
  "/fonts/Vazirmatn-Regular.woff2",
  "/fonts/Vazirmatn-Medium.woff2",
  "/fonts/Vazirmatn-Bold.woff2",
];

function tenantOf(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/pharma_tid=([^;]*)/);
  return m ? m[1] : "anon";
}

function cacheKey(request) {
  const sep = request.url.includes("?") ? "&" : "?";
  return new Request(`${request.url}${sep}__tid=${tenantOf(request)}`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
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
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const network = await fetch(request);
  if (network.ok) cache.put(request, network.clone());
  return network;
}

async function navigationFallback(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, res.clone());
      return res;
    }
  } catch {
    /* offline */
  }
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const root = await cache.match("/");
  if (root) return root;
  return new Response("حالت آفلاین — اتصال اینترنت برقرار نیست", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigationFallback(request));
  }
});

/* ---------- Web Push (اعلان حتی با اپ بسته) ---------- */

self.addEventListener("push", (event) => {
  let data = { title: "دستیار خرید داروخانه", body: "", url: "/cheques" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* بدون payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-512.png",
      badge: "/icons/icon-512.png",
      dir: "rtl",
      lang: "fa",
      tag: "pharma-push",
      data: { url: data.url || "/cheques" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/cheques";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
