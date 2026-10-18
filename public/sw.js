/* Service worker: app shell + multi-tenant-safe offline caching.
 *
 * نسخه از روی query همین فایل خوانده می‌شود (/sw.js?v=<buildId>) و با هر build عوض
 * می‌شود؛ پس با هر deploy کش‌های قدیمی خودکار پاک می‌شوند.
 *
 * صفحه‌ها و API: network-first با timeout (فقط اگر شبکه نبود/کند بود از کش).
 * فایل‌های نام‌دارِ نسخه‌دار (/_next/static، فونت، آیکون): cache-first.
 * کش API و صفحه‌ها per-tenant است (کوکی pharma_tid با cookieStore خوانده می‌شود؛
 * اگر tenant معلوم نبود، چیزی در کش ذخیره/خوانده نمی‌شود). */

const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const VERSION = `pharma-${SW_VERSION}`;
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE = [
  "/",
  "/manifest.json",
  "/icons/icon-512.png",
  "/fonts/Vazirmatn-Regular.woff2",
  "/fonts/Vazirmatn-Medium.woff2",
  "/fonts/Vazirmatn-Bold.woff2",
];

// مسیرهایی که هرگز کش نمی‌شوند
const NO_CACHE_API = ["/api/selftest", "/api/admin/", "/api/auth-test", "/api/sentry-test", "/api/push/"];

/* کوکی pharma_tid (httpOnly نیست). هدر Cookie در service worker در دسترس نیست،
 * پس از cookieStore می‌خوانیم؛ اگر مرورگر پشتیبانی نکند null برمی‌گردد. */
async function tenantOf() {
  try {
    if (self.cookieStore && self.cookieStore.get) {
      const c = await self.cookieStore.get("pharma_tid");
      if (c && c.value) return c.value;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function keyFor(request, tid) {
  const sep = request.url.includes("?") ? "&" : "?";
  return new Request(`${request.url}${sep}__tid=${encodeURIComponent(tid)}`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* network-first: اگر شبکه تا timeout جواب نداد و در کش نسخه‌ای هست، همان را بده
 * (درخواست شبکه ادامه می‌یابد و کش را تازه می‌کند). اگر کش نبود، منتظر شبکه می‌مانیم. */
async function networkFirst(event, cacheName, tid) {
  const request = event.request;
  const cache = await caches.open(cacheName);
  const key = tid ? keyFor(request, tid) : null;

  const networkPromise = fetch(request).then((res) => {
    if (key && res && res.ok) {
      const put = cache.put(key, res.clone()).catch(() => undefined);
      try {
        event.waitUntil(put); // اگر رویداد دیگر فعال نیست خطا می‌دهد؛ مهم نیست
      } catch {
        /* ignore */
      }
    }
    return res;
  });

  if (!key) return networkPromise; // tenant نامعلوم: بدون کش

  const cachedPromise = cache.match(key);
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), NETWORK_TIMEOUT_MS));

  try {
    const first = await Promise.race([networkPromise, timeout]);
    if (first !== "timeout") return first;
    const cached = await cachedPromise;
    if (cached) {
      networkPromise.catch(() => undefined); // به‌روزرسانی پس‌زمینه
      return cached;
    }
    return await networkPromise;
  } catch (err) {
    const cached = await cachedPromise;
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const network = await fetch(request);
  if (network.ok) cache.put(request, network.clone());
  return network;
}

async function navigationHandler(event) {
  const tid = await tenantOf();
  try {
    return await networkFirst(event, RUNTIME_CACHE, tid);
  } catch {
    /* آفلاین و بدون نسخه‌ی کش‌شده */
  }
  const cache = await caches.open(STATIC_CACHE);
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
  if (url.pathname === "/sw.js" || url.pathname === "/manifest.json") return;

  if (url.pathname.startsWith("/api/")) {
    if (NO_CACHE_API.some((p) => url.pathname.startsWith(p))) return;
    event.respondWith(
      tenantOf().then((tid) => networkFirst(event, RUNTIME_CACHE, tid))
    );
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
  const accept = request.headers.get("accept") || "";
  if (request.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith(navigationHandler(event));
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
