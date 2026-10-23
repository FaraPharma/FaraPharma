import { and, asc, eq, gte, lt } from "drizzle-orm";
import { withSystemRole } from "@/db";
import { catalogFileChunks } from "@/db/schema";
import { AwsClient } from "aws4fetch";

/**
 * Separate storage layer for visitor catalog files. The original PDF is
 * never stored in the main tables and is never rendered on page loads —
 * pages only reference a file key; downloads go through an explicit route.
 *
 * Backends:
 *  - S3-compatible (MinIO/R2/Backblaze/…) when S3_ENDPOINT, S3_BUCKET,
 *    S3_ACCESS_KEY and S3_SECRET_KEY are configured (signed via aws4fetch).
 *  - جدول catalog_blobs در دیتابیس otherwise (روی Workers دیسک ماندگار نیست).
 *    دسترسی فقط با نقش سیستم؛ مسیر دانلود قبلش مالکیت tenant را بررسی می‌کند.
 */

const S3_CONFIGURED =
  !!process.env.S3_ENDPOINT &&
  !!process.env.S3_BUCKET &&
  !!process.env.S3_ACCESS_KEY &&
  !!process.env.S3_SECRET_KEY;

// روی Workers یک بسته‌ی نوشتنِ بزرگ (تک‌ردیف > حدود ۳۲–۶۴KB) اتصال را می‌بندد (آزمون ۳۸: ۱۶KB ok، ۶۴KB FAIL).
// پس: قطعه‌ی ۶KB خام = ۸KB base64، دو ردیف در هر INSERT (≈۱۶KB). هر تراکنش یک اتصال؛ همه‌ی قطعه‌ها پشت‌سرهم.
// قطعه‌ی ۱۲KB خام = ۱۶KB base64 (تک‌پارامترِ بزرگ‌تر از ≈۳۲–۶۴KB روی اتصال Workers قطع می‌شد).
// برای کم‌کردن رفت‌وبرگشت، چند ردیف در یک INSERT و چند INSERT در یک تراکنشِ کوچک؛ اگر دستور بزرگ جواب نداد،
// خودکار پله‌به‌پله کوچک‌تر می‌شود (۸ → ۴ → ۲ → ۱ ردیف) و پله‌ی جواب‌دهنده تا پایان عمر Worker یادآوری می‌شود.
const CHUNK = 12 * 1024;
// اندازه‌گیری روی Workers: ۸ و ۴ ردیف (≈۶۴ و ۱۲۸KB در یک دستور) اتصال را می‌بندد، ۲ ردیف (≈۳۲KB) جواب می‌دهد؛
// پس پله‌ی اول همان ۲ است (بدون تلاش شکست‌خورده‌ی هر Worker تازه).
const WRITE_LADDER = [2, 1];
const READ_LADDER = [32, 16, 8, 4, 2, 1];
const STATEMENTS_PER_TX = 16; // هر تراکنش ≈۵۱۲KB؛ سربار BEGIN/COMMIT کمتر
/** سقف حجم فایل آپلودی (مسیر آپلود و آزمون ۳۸ هر دو از همین مقدار استفاده می‌کنند) */
export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
let writeStep = 0;
let readStep = 0;
export const STORAGE_INFO = {
  chunkBytes: CHUNK,
  b64Chars: (CHUNK / 3) * 4,
  stmtsPerTx: STATEMENTS_PER_TX,
  get rowsPerInsert() {
    return WRITE_LADDER[writeStep];
  },
  get readBatch() {
    return READ_LADDER[readStep];
  },
};

function b64enc(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
}

function b64dec(b: string): Uint8Array {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

let s3: AwsClient | null = null;

function s3Client(): AwsClient {
  if (!s3) {
    s3 = new AwsClient({
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
      region: process.env.S3_REGION ?? "us-east-1",
      service: "s3",
    });
  }
  return s3;
}

function s3Url(key: string): string {
  const endpoint = process.env.S3_ENDPOINT!.replace(/\/+$/, "");
  return `${endpoint}/${process.env.S3_BUCKET}/${key}`;
}

export interface StorageAdapter {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export const storage: StorageAdapter = {
  async put(key, body, contentType) {
    if (S3_CONFIGURED) {
      const res = await s3Client().fetch(s3Url(key), {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: body as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
      return;
    }
    const total = Math.max(1, Math.ceil(body.length / CHUNK));
    try {
      for (let start = 0; start < total; ) {
        const rpi = WRITE_LADDER[writeStep];
        const end = Math.min(start + rpi * STATEMENTS_PER_TX, total);
        try {
          await withSystemRole(async (tx) => {
            for (let i = start; i < end; i += rpi) {
              const rows = [];
              for (let j = i; j < Math.min(i + rpi, end); j++) {
                rows.push({ fileKey: key, part: j, b64: b64enc(body.subarray(j * CHUNK, (j + 1) * CHUNK)) });
              }
              await tx.insert(catalogFileChunks).values(rows);
            }
          });
          start = end; // این گروه کامل ثبت شد
        } catch (e) {
          // گروه با rollback کامل برگشته؛ با دستورهای کوچک‌تر دوباره (بی‌خطر است)
          if (writeStep < WRITE_LADDER.length - 1) writeStep++;
          else throw e;
        }
      }
    } catch (e) {
      // قطعه‌های نیمه‌کاره‌ی این کلید باقی نماند
      await withSystemRole((tx) => tx.delete(catalogFileChunks).where(eq(catalogFileChunks.fileKey, key))).catch(() => undefined);
      throw e;
    }
  },
  async get(key) {
    if (S3_CONFIGURED) {
      const res = await s3Client().fetch(s3Url(key), { method: "GET" });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    }
    const parts: Uint8Array[] = [];
    for (let from = 0; ; ) {
      const bs = READ_LADDER[readStep];
      let rows: Array<{ b64: string }>;
      try {
        rows = await withSystemRole((tx) =>
          tx
            .select({ b64: catalogFileChunks.b64 })
            .from(catalogFileChunks)
            .where(and(eq(catalogFileChunks.fileKey, key), gte(catalogFileChunks.part, from), lt(catalogFileChunks.part, from + bs)))
            .orderBy(asc(catalogFileChunks.part))
        );
      } catch (e) {
        if (readStep < READ_LADDER.length - 1) {
          readStep++; // پاسخ کوچک‌تر
          continue;
        }
        throw e;
      }
      for (const r of rows) parts.push(b64dec(r.b64));
      if (rows.length < bs) break;
      from += bs;
    }
    if (parts.length === 0) return null;
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  },
};
