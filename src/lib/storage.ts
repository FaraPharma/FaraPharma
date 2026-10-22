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

const CHUNK = 48 * 1024; // ۴۸KB خام = ۶۴KB base64
const READ_BATCH = 16;

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
    // base64 در ستون text، قطعه‌های ۴۸KB (= ۶۴KB متن) در یک تراکنش؛ بدون bytea
    await withSystemRole(async (tx) => {
      for (let i = 0, off = 0; off < body.length || i === 0; i++, off += CHUNK) {
        await tx.insert(catalogFileChunks).values({ fileKey: key, part: i, b64: b64enc(body.subarray(off, off + CHUNK)) });
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
    for (let from = 0; ; from += READ_BATCH) {
      const rows = await withSystemRole((tx) =>
        tx
          .select({ b64: catalogFileChunks.b64 })
          .from(catalogFileChunks)
          .where(and(eq(catalogFileChunks.fileKey, key), gte(catalogFileChunks.part, from), lt(catalogFileChunks.part, from + READ_BATCH)))
          .orderBy(asc(catalogFileChunks.part))
      );
      parts.push(...rows.map((r) => b64dec(r.b64)));
      if (rows.length < READ_BATCH) break;
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
