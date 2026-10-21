/* صف آفلاینِ سفارش: در نبود اینترنت، سفارش در IndexedDB می‌ماند و با اتصال
 * (یا باز شدن برنامه) ثبت می‌شود. کلید یکتای سفارش (clientKey) جلوی ثبت تکراری را می‌گیرد.
 * سفارشی که سرور رد کند هرگز بی‌صدا حذف نمی‌شود. */

import { createOrderAction } from "@/actions/orders";

type OrderInput = Parameters<typeof createOrderAction>[0];

const DB_NAME = "pharma-outbox";
const STORE = "orders";

interface QueuedOrder {
  id: string;
  tenant: string;
  input: OrderInput;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function tenant(): string {
  const m = document.cookie.match(/(?:^|;\s*)pharma_tid=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "anon";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("indexedDB not available"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const all = () => run<QueuedOrder[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedOrder[]>);

export async function queueOrder(input: OrderInput): Promise<void> {
  const key = input.clientKey && /^[A-Za-z0-9_-]{8,64}$/.test(input.clientKey) ? input.clientKey : crypto.randomUUID();
  await run("readwrite", (s) =>
    s.put({ id: key, tenant: tenant(), input: { ...input, clientKey: key }, createdAt: Date.now(), attempts: 0 } satisfies QueuedOrder)
  );
}

export async function pendingOrders(): Promise<number> {
  try {
    return (await all()).filter((o) => o.tenant === tenant()).length;
  } catch {
    return 0;
  }
}

let flushing: Promise<{ sent: number; rejectedNew: number; remaining: number }> | null = null;

/** ثبت سفارش‌های صف‌شده‌ی همین داروخانه؛ هرگز خطا پرت نمی‌کند */
export function flushOrders() {
  if (!flushing) flushing = doFlush().finally(() => (flushing = null));
  return flushing;
}

async function doFlush() {
  let sent = 0;
  let rejectedNew = 0;
  try {
    const mine = (await all()).filter((o) => o.tenant === tenant()).sort((a, b) => a.createdAt - b.createdAt);
    for (const o of mine) {
      try {
        const res = await createOrderAction(o.input);
        if (res.ok) {
          await run("readwrite", (s) => s.delete(o.id));
          sent++;
        } else {
          if (o.attempts === 0) rejectedNew++;
          await run("readwrite", (s) => s.put({ ...o, attempts: o.attempts + 1, lastError: String(res.error ?? "").slice(0, 200) }));
        }
      } catch {
        break; // آفلاین یا نشست نامعتبر: صف دست‌نخورده می‌ماند
      }
    }
  } catch {
    /* IndexedDB در دسترس نیست */
  }
  let remaining = 0;
  try {
    remaining = (await all()).filter((o) => o.tenant === tenant()).length;
  } catch {}
  if (sent > 0 && typeof window !== "undefined") window.dispatchEvent(new Event("outbox-synced"));
  return { sent, rejectedNew, remaining };
}
