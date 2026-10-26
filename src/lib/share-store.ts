/**
 * فایل‌های دریافت‌شده از «اشتراک‌گذاری» در IndexedDB دستگاه (نوشتن با سرویس‌ورکر، خواندن در صفحه‌ی /import-share).
 * نام پایگاه و ساختار باید با public/sw.js یکی باشد.
 */
export const SHARE_DB = "pharma-share";
export const SHARE_STORE = "files";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SharedEntry {
  id: string;
  name: string;
  type: string;
  size: number;
  at: number;
  /** داروخانه‌ای که هنگام دریافت وارد شده بود (null: وارد نبود) */
  tid: string | null;
  /** مشکل تشخیص‌داده‌شده در سرویس‌ورکر (نوع/خالی/حجم) */
  problem?: "type" | "empty" | "big";
  blob?: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) req.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, mode);
    const r = fn(tx.objectStore(SHARE_STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** فایل‌های منتظرِ ورود برای این داروخانه (قدیمی‌ترین اول)؛ مال داروخانه‌ی دیگر دیده نمی‌شود و بعد از یک روز پاک می‌شود */
export async function listShared(tenantId: string | null): Promise<SharedEntry[]> {
  const db = await open();
  try {
    const all = await wrap<SharedEntry[]>(db, "readonly", (s) => s.getAll());
    const now = Date.now();
    for (const e of all) if (now - e.at > DAY_MS) await wrap(db, "readwrite", (s) => s.delete(e.id)).catch(() => undefined);
    return all
      .filter((e) => now - e.at <= DAY_MS && (e.tid === null || tenantId === null || e.tid === tenantId))
      .sort((a, b) => a.at - b.at);
  } finally {
    db.close();
  }
}

export async function removeShared(id: string): Promise<void> {
  const db = await open();
  try {
    await wrap(db, "readwrite", (s) => s.delete(id));
  } finally {
    db.close();
  }
}

/** شناسه‌ی داروخانه‌ی واردشده از کوکی غیرحساس pharma_tid (همان که سرویس‌ورکر هم می‌خواند) */
export function currentTenantId(): string | null {
  const m = /(?:^|;\s*)pharma_tid=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : null;
}
