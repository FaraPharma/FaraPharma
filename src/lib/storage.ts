import { eq } from "drizzle-orm";
import { withSystemRole } from "@/db";
import { catalogBlobs } from "@/db/schema";
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
    await withSystemRole((tx) =>
      tx.insert(catalogBlobs).values({ fileKey: key, data: body }).onConflictDoUpdate({ target: catalogBlobs.fileKey, set: { data: body } })
    );
  },

  async get(key) {
    if (S3_CONFIGURED) {
      const res = await s3Client().fetch(s3Url(key), { method: "GET" });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    }
    const rows = await withSystemRole((tx) => tx.select({ data: catalogBlobs.data }).from(catalogBlobs).where(eq(catalogBlobs.fileKey, key)).limit(1));
    return rows[0]?.data ?? null;
  },
};
