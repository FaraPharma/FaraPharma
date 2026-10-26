import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { catalogFiles, visitors } from "@/db/schema";
import { logServerError } from "@/lib/log";
import { loadListAges } from "@/lib/list-age";
import type { VisitorCand } from "@/lib/share-detect";

export const dynamic = "force-dynamic";

/** ویزیتورهای داروخانه‌ی جاری با نام آخرین فایل و زمان آخرین ورود لیست (برای تشخیص خودکار از نام فایل) */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const list = await withTenant(ctx, async (tx): Promise<VisitorCand[]> => {
      const [vs, files, ages] = await Promise.all([
        tx
          .select({ id: visitors.id, name: visitors.name, company: visitors.company })
          .from(visitors)
          .where(eq(visitors.tenantId, ctx.tenantId)),
        tx
          .select({ visitorId: catalogFiles.visitorId, fileName: catalogFiles.fileName, createdAt: catalogFiles.createdAt })
          .from(catalogFiles)
          .where(eq(catalogFiles.tenantId, ctx.tenantId))
          .orderBy(desc(catalogFiles.createdAt))
          .limit(2000),
        loadListAges(tx, ctx.tenantId),
      ]);
      const lastFile = new Map<string, { name: string; at: string }>();
      for (const f of files) {
        if (!lastFile.has(f.visitorId)) lastFile.set(f.visitorId, { name: f.fileName, at: new Date(f.createdAt).toISOString() });
      }
      return vs.map((v) => {
        const lf = lastFile.get(v.id);
        return {
          id: v.id,
          name: v.name,
          company: v.company,
          lastFileName: lf?.name ?? null,
          // آخرین ورود لیست؛ اگر لیستی وارد نشده، زمان آخرین فایل ذخیره‌شده
          lastImportAt: ages.get(v.id) ?? lf?.at ?? null,
        };
      });
    });
    return NextResponse.json({ visitors: list });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/import-share/visitors", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطای سرور" }, { status });
  }
}
