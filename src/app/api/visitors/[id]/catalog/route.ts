import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { assertWritable } from "@/db/access";
import { visitors, catalogFiles } from "@/db/schema";
import { storage } from "@/lib/storage";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 15 * 1024 * 1024;

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
        { error: "حجم فایل بیشتر از ۱۵ مگابایت است" },
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
    if (!fileName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "فقط فایل PDF قابل قبول است" },
        { status: 400 }
      );
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "فایل خالی است" }, { status: 400 });
    }
    if (buf.length > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "حجم فایل بیشتر از ۱۵ مگابایت است" },
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
      const key = `tenants/${ctx.tenantId}/catalogs/${visitorId}/${randomUUID()}.pdf`;
      const row = await tx
        .insert(catalogFiles)
        .values({
          tenantId: ctx.tenantId,
          visitorId,
          fileName,
          fileKey: key,
          mimeType: file.type || "application/pdf",
          sizeBytes: buf.length,
          status: "stored",
        })
        .returning({ id: catalogFiles.id });
      return { catalogId: row[0].id, fileKey: key };
    });

    // 2) store the file in the separate storage
    try {
      await storage.put(fileKey, buf, file.type || "application/pdf");
    } catch {
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
