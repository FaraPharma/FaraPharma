import fs from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * Separate storage layer for visitor catalog files. The original PDF is
 * never stored in the main tables and is never rendered on page loads —
 * pages only reference a file key; downloads go through an explicit route.
 *
 * Backends:
 *  - S3-compatible (MinIO/R2/Backblaze/…) when S3_ENDPOINT, S3_BUCKET,
 *    S3_ACCESS_KEY and S3_SECRET_KEY are configured (signed via aws4fetch).
 *  - Local filesystem under ./storage otherwise (dev / self-hosted).
 */

const S3_CONFIGURED =
  !!process.env.S3_ENDPOINT &&
  !!process.env.S3_BUCKET &&
  !!process.env.S3_ACCESS_KEY &&
  !!process.env.S3_SECRET_KEY;

const LOCAL_ROOT = path.join(process.cwd(), "storage");

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
    const full = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  },

  async get(key) {
    if (S3_CONFIGURED) {
      const res = await s3Client().fetch(s3Url(key), { method: "GET" });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    }
    try {
      const buf = await fs.readFile(path.join(LOCAL_ROOT, key));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  },
};
