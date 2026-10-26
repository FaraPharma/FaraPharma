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
const NETWORK_TIMEOUT_MS = 8000;

const PRECACHE = [
  "/",
  "/manifest.json",
  "/icons/icon-512.png",
  "/fonts/Vazirmatn-Regular.woff2",
  "/fonts/Vazirmatn-Medium.woff2",
  "/fonts/Vazirmatn-Bold.woff2",
];

// مسیرهایی که هرگز کش نمی‌شوند
const NO_CACHE_API = ["/api/health", "/api/selftest", "/api/admin/", "/api/auth-test", "/api/sentry-test", "/api/push/"];

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


/* ---------- دریافت فایل از «اشتراک‌گذاری» (Web Share Target) ----------
 * پیام‌رسان‌ها فایل را با POST به /share-target می‌فرستند. فایل در IndexedDB دستگاه نگه داشته می‌شود
 * و کاربر به /import-share می‌رود (اگر وارد نشده باشد، بعد از ورود همان‌جا برمی‌گردد و فایل از دست نمی‌رود).
 * نام پایگاه و ساختار باید با src/lib/share-store.ts یکی باشد؛ قواعد نوع/حجم با src/lib/share-detect.ts. */

const SHARE_DB = "pharma-share";
const SHARE_STORE = "files";
const SHARE_MAX_BYTES = 3 * 1024 * 1024;
const SHARE_EXTS = ["pdf", "xlsx", "xls", "csv"];
const SHARE_MIMES = [
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
];
const SHARE_KEEP_MS = 24 * 60 * 60 * 1000;

function shareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) req.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function shareTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, mode);
    const r = fn(tx.objectStore(SHARE_STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function shareProblem(file) {
  if (!file.size) return "empty";
  if (file.size > SHARE_MAX_BYTES) return "big";
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(file.name || "");
  const ext = m ? m[1].toLowerCase() : "";
  // پیام‌رسان‌ها گاهی application/octet-stream می‌دهند؛ پسوند نام فایل در اولویت است
  if (SHARE_EXTS.includes(ext)) return null;
  const mime = String(file.type || "").toLowerCase().split(";")[0].trim();
  return SHARE_MIMES.includes(mime) ? null : "type";
}

async function handleShareTarget(request) {
  const go = (q) => Response.redirect(new URL("/import-share" + q, self.location.origin).href, 303);
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f) => f && typeof f === "object" && "size" in f);
    if (files.length === 0) return go("?e=empty");
    const tid = await tenantOf();
    const db = await shareDb();
    try {
      const now = Date.now();
      const old = await shareTx(db, "readonly", (s) => s.getAll());
      for (const e of old) if (now - e.at > SHARE_KEEP_MS) await shareTx(db, "readwrite", (s) => s.delete(e.id));
      let i = 0;
      for (const f of files.slice(0, 5)) {
        const problem = shareProblem(f);
        const id = now.toString(36) + "-" + (i++) + "-" + Math.random().toString(36).slice(2, 8);
        // فایل مشکل‌دار (نوع/خالی/حجم) فقط به‌صورت پیام نگه داشته می‌شود، نه خود فایل
        const entry = { id, name: f.name || "file", type: f.type || "", size: f.size, at: now + i, tid };
        if (problem) entry.problem = problem;
        else entry.blob = f;
        await shareTx(db, "readwrite", (s) => s.put(entry));
      }
    } finally {
      db.close();
    }
    return go("");
  } catch {
    return go("?e=fail");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "POST") {
    if (new URL(request.url).pathname === "/share-target") event.respondWith(handleShareTarget(request));
    return;
  }
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
