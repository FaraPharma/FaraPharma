import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { catalogFiles } from "@/db/schema";
import { storage } from "@/lib/storage";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Explicit download of the original catalog file. The file is never
 * rendered inline anywhere — pages only show its metadata; this route is
 * the single tenant-scoped way to retrieve it.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const ctx = await requireAuth();
    const row = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: catalogFiles.id,
          fileName: catalogFiles.fileName,
          fileKey: catalogFiles.fileKey,
          mimeType: catalogFiles.mimeType,
        })
        .from(catalogFiles)
        .where(
          and(
            eq(catalogFiles.id, id),
            eq(catalogFiles.tenantId, ctx.tenantId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    });
    if (!row) {
      return NextResponse.json({ error: "فایل یافت نشد" }, { status: 404 });
    }
    const buf = await storage.get(row.fileKey);
    if (!buf) {
      return NextResponse.json(
        { error: "این فایل ذخیره نشده بود؛ لطفاً دوباره بارگذاری کنید" },
        { status: 404 }
      );
    }
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": /^[a-z]+\/[a-z0-9.+-]+$/i.test(row.mimeType) ? row.mimeType : "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/catalog/[id]/file", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
