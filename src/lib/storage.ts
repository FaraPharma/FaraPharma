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
const CHUNK = 6 * 1024;
const ROWS_PER_INSERT = 2;
const READ_BATCH = 8;
export const STORAGE_INFO = { chunkBytes: CHUNK, b64Chars: (CHUNK / 3) * 4, rowsPerInsert: ROWS_PER_INSERT, readBatch: READ_BATCH };

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
    // base64 در ستون text؛ هر INSERT حداکثر ROWS_PER_INSERT قطعه‌ی کوچک؛ همه در یک تراکنش
    await withSystemRole(async (tx) => {
      const total = Math.max(1, Math.ceil(body.length / CHUNK));
      for (let i = 0; i < total; i += ROWS_PER_INSERT) {
        const rows = [];
        for (let j = i; j < Math.min(i + ROWS_PER_INSERT, total); j++) {
          rows.push({ fileKey: key, part: j, b64: b64enc(body.subarray(j * CHUNK, (j + 1) * CHUNK)) });
        }
        await tx.insert(catalogFileChunks).values(rows);
      }
    });
  },

  async get(key) {
    if (S3_CONFIGURED) {
      const res = await s3Client().fetch(s3Url(key), { method: "GET" });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    }
    const parts: Uint8Array[] = [];
    // همه‌ی خواندن‌ها در یک تراکنش (هر تراکنش چند رفت‌وبرگشت دارد؛ جدا کردنشان کند می‌شود)
    await withSystemRole(async (tx) => {
      for (let from = 0; ; from += READ_BATCH) {
        const rows = await tx
          .select({ b64: catalogFileChunks.b64 })
          .from(catalogFileChunks)
          .where(and(eq(catalogFileChunks.fileKey, key), gte(catalogFileChunks.part, from), lt(catalogFileChunks.part, from + READ_BATCH)))
          .orderBy(asc(catalogFileChunks.part));
        for (const r of rows) parts.push(b64dec(r.b64));
        if (rows.length < READ_BATCH) break;
      }
    });
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
