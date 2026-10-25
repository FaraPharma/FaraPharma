import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { visitorProducts } from "@/db/schema";

/**
 * زمان آخرین ورود لیست هر ویزیتور (ISO). «سن لیست» = آخرین به‌روزرسانیِ ردیف‌های واردشده از فایل؛
 * اگر ویزیتوری هیچ فایلی نداشته، آخرین تغییر ردیف‌هایش. ویزیتور بدون ردیف در نقشه نیست.
 */
export async function loadListAges(tx: Tx, tenantId: string): Promise<Map<string, string | null>> {
  const ages = await tx
    .select({
      visitorId: visitorProducts.visitorId,
      importedAt: sql<string | null>`max(${visitorProducts.updatedAt}) filter (where ${visitorProducts.lastImportId} is not null)`,
      anyAt: sql<string | null>`max(${visitorProducts.updatedAt})`,
    })
    .from(visitorProducts)
    .where(eq(visitorProducts.tenantId, tenantId))
    .groupBy(visitorProducts.visitorId);
  const out = new Map<string, string | null>();
  for (const a of ages) {
    const v = a.importedAt ?? a.anyAt;
    out.set(a.visitorId, v ? new Date(v).toISOString() : null);
  }
  return out;
}
