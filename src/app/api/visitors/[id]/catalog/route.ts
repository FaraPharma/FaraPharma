import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { assertWritable } from "@/db/access";
import { visitors, catalogFiles } from "@/db/schema";
import { storage, MAX_CATALOG_BYTES, MAX_CATALOG_MB } from "@/lib/storage";
import { logServerError } from "@/lib/log";
import { recordError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

// ذخیره‌ی دیتابیسی با ۴ اتصال هم‌زمان؛ سقف حجم در storage.ts (بدون S3: ۳MB، با S3/R2: ۱۰MB)
const MAX_PDF_BYTES = MAX_CATALOG_BYTES; // همان سقفی که آزمون ۳۸ می‌سنجد

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};

/**
 * Uploads a PDF catalog as a simple reference file for a visitor.
 * No automatic processing of any kind: the file is stored in the separate
 * storage (S3-compatible or local disk), never in the main tables, and is
 * only available for viewing/downloading.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: visitorId } = await context.params;
  try {
    const ctx = await requireAuth();

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `حجم فایل بیشتر از ${MAX_CATALOG_MB} مگابایت است؛ فایل را فشرده یا کوچک‌تر کنید` },
        { status: 413 }
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "فایل معتبر ارسال نشده است" },
        { status: 400 }
      );
    }

    const fileEntry = form.get("file");
    if (!fileEntry || typeof fileEntry === "string") {
      return NextResponse.json(
        { error: "فایل انتخاب نشده است" },
        { status: 400 }
      );
    }
    const file = fileEntry as File;
    const fileName = file.name || "catalog.pdf";
    const ext = (fileName.toLowerCase().match(/\.(pdf|xlsx|xls|csv)$/) ?? [])[1];
    if (!ext) {
      return NextResponse.json(
        { error: "فقط فایل PDF یا اکسل (xlsx / xls / csv) قابل قبول است" },
        { status: 400 }
      );
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "فایل خالی است" }, { status: 400 });
    }
    if (buf.length > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `حجم فایل بیشتر از ${MAX_CATALOG_MB} مگابایت است؛ فایل را فشرده یا کوچک‌تر کنید` },
        { status: 413 }
      );
    }

    // 1) tenant-scoped: verify visitor + create the file record
    const { catalogId, fileKey } = await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const v = await tx
        .select({ id: visitors.id })
        .from(visitors)
        .where(
          and(eq(visitors.id, visitorId), eq(visitors.tenantId, ctx.tenantId))
        )
        .limit(1);
      if (!v[0]) throw new AppError("ویزیتور یافت نشد", 404);
      const key = `tenants/${ctx.tenantId}/catalogs/${visitorId}/${randomUUID()}.${ext}`;
      const row = await tx
        .insert(catalogFiles)
        .values({
          tenantId: ctx.tenantId,
          visitorId,
          fileName,
          fileKey: key,
          mimeType: MIME_BY_EXT[ext],
          sizeBytes: buf.length,
          status: "stored",
        })
        .returning({ id: catalogFiles.id });
      return { catalogId: row[0].id, fileKey: key };
    });

    // 2) store the file in the separate storage
    try {
      await storage.put(fileKey, buf, MIME_BY_EXT[ext]);
    } catch (e) {
      await recordError("/api/visitors/[id]/catalog (storage.put)", e, { tenantId: ctx.tenantId, userId: ctx.userId });
      // ردیف بدون فایل باقی نماند
      await withTenant(ctx, (tx) => tx.delete(catalogFiles).where(eq(catalogFiles.id, catalogId))).catch(() => undefined);
      return NextResponse.json(
        { error: "ذخیره فایل در مخزن ناموفق بود" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, catalogId });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/visitors/[id]/catalog", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
