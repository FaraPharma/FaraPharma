/* صف آفلاین یادداشت سریع:
 * در نبود اینترنت، یادداشت در IndexedDB میماند و با وصلشدن
 * خودکار به سرور همگام میشود (بدون از دست رفتن داده). */

const DB_NAME = "pharma-offline-queue";
const STORE = "quick_notes";

export interface QueuedNote {
  id: string;
  body: string;
  createdAt: number;
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
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(): Promise<QueuedNote[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result as QueuedNote[]) ?? []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function put(note: QueuedNote): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(note);
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

async function remove(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
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

/**
 * ثبت یادداشت: اگر اینترنت هست مستقیم به سرور؛ وگرنه در صف محلی
 * ذخیره میشود. خروجی مشخص میکند که یادداشت در صف مانده یا نه.
 */
export async function enqueueQuickNote(body: string): Promise<{
  synced: boolean;
  queuedCount: number;
  error?: string;
}> {
  const trimmed = body.trim();
  if (!trimmed) return { synced: false, queuedCount: 0, error: "متن خالی است" };

  const queue = await getAll();
  const note: QueuedNote = {
    id: crypto.randomUUID(),
    body: trimmed.slice(0, 5000),
    createdAt: Date.now(),
  };
  await put(note);

  // تلاش برای همگامسازی فوری کل صف
  const result = await flushQuickNotes();
  return {
    synced: result.remaining === 0,
    queuedCount: result.remaining,
  };
}

/** فلاش صف: هرچه ممکن است به سرور بفرستد و ارسالشدهها را حذف کند */
export async function flushQuickNotes(): Promise<{
  sent: number;
  remaining: number;
}> {
  const queue = await getAll();
  let sent = 0;
  for (const note of queue) {
    try {
      const res = await fetch("/api/quick-notes/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: note.body, createdAt: note.createdAt }),
      });
      if (res.ok) {
        await remove(note.id);
        sent++;
      } else if (res.status === 401) {
        // بدون جلسه معتبر، صف را فلاش نمیکنیم
        break;
      }
      // خطاهای شبکه → next iteration صبر میکنیم
    } catch {
      break; // آفلاین
    }
  }
  const remaining = (await getAll()).length;
  return { sent, remaining };
}

/** شمار یادداشتهای در انتظار (برای نشانگر UI) */
export async function pendingQuickNotes(): Promise<number> {
  try {
    return (await getAll()).length;
  } catch {
    return 0;
  }
}
