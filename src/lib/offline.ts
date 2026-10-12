/* Offline-first data layer: every successful GET response is mirrored into
 * IndexedDB (keyed by URL + tenant cookie) so the last known version of the
 * data survives even if the service-worker cache is evicted. */

import { markOnlineNow } from "@/lib/connectivity";

const DB_NAME = "pharma-offline";
const STORE = "cache";

export interface OfflineResult<T> {
  data: T | null;
  stale: boolean;
  error: string | null;
  savedAt: number | null;
  status: number;
}

function clientTenant(): string {
  if (typeof document === "undefined") return "anon";
  const m = document.cookie.match(/(?:^|;\s*)pharma_tid=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "anon";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putCache(
  key: string,
  entry: { body: unknown; savedAt: number }
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, body: entry.body, savedAt: entry.savedAt });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getCache(
  key: string
): Promise<{ body: unknown; savedAt: number } | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      db.close();
      const row = req.result as { body?: unknown; savedAt?: number } | undefined;
      resolve(row?.body !== undefined && row.savedAt ? { body: row.body, savedAt: row.savedAt } : null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function offlineFetch<T>(url: string): Promise<OfflineResult<T>> {
  const cacheKey = `${url}|${clientTenant()}`;
  try {
    const res = await fetch(url);
    // دریافت هر پاسخ واقعی از سرور (حتی خطا) یعنی مسیر شبکه زنده است
    markOnlineNow();
    if (res.ok) {
      const json = (await res.json()) as T;
      const savedAt = Date.now();
      try {
        await putCache(cacheKey, { body: json, savedAt });
      } catch {
        /* storage full / private mode — non fatal */
      }
      return { data: json, stale: false, error: null, savedAt, status: res.status };
    }
    if (res.status === 401) {
      return { data: null, stale: false, error: null, savedAt: null, status: 401 };
    }
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    const cached = await getCache(cacheKey).catch(() => null);
    if (cached) {
      return {
        data: cached.body as T,
        stale: true,
        error: errBody?.error ?? "خطا در دریافت اطلاعات",
        savedAt: cached.savedAt,
        status: res.status,
      };
    }
    return {
      data: null,
      stale: false,
      error: errBody?.error ?? "خطا در دریافت اطلاعات",
      savedAt: null,
      status: res.status,
    };
  } catch {
    const cached = await getCache(cacheKey).catch(() => null);
    if (cached) {
      return { data: cached.body as T, stale: true, error: null, savedAt: cached.savedAt, status: 200 };
    }
    return {
      data: null,
      stale: false,
      error: "اتصال برقرار نیست و داده ذخیره‌شده‌ای موجود نیست",
      savedAt: null,
      status: 0,
    };
  }
}
