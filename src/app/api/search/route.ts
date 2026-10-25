import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, or, ne, sql } from "drizzle-orm";
import { AppError, withTenant, type Tx } from "@/db";
import { requireAuth } from "@/lib/auth";
import { visitors, products, visitorProducts, quickNotes } from "@/db/schema";
import { logServerError } from "@/lib/log";
import {
  normalizeText,
  tokenize,
  searchEntries,
  getCachedEntries,
  setCachedEntries,
  type SearchEntry,
} from "@/lib/product-search";

export const dynamic = "force-dynamic";

/** فهرست کالاهای موجودِ هر tenant (چند هزار ردیف) برای امتیازدهی در کد؛ با کش ۱۰ثانیه‌ای تا هر تایپ دیتابیس را نزند. */
async function loadEntries(tx: Tx, tenantId: string): Promise<SearchEntry[]> {
  const cached = getCachedEntries(tenantId);
  if (cached) return cached;

  const rows = await tx
    .select({
      id: visitorProducts.id,
      name: products.name,
      visitorId: visitors.id,
      visitorName: visitors.name,
      price: visitorProducts.price,
      qty: visitorProducts.qty,
      unit: visitorProducts.unit,
      stock: visitorProducts.stock,
    })
    .from(visitorProducts)
    .innerJoin(products, eq(visitorProducts.productId, products.id))
    .innerJoin(visitors, eq(visitorProducts.visitorId, visitors.id))
    .where(and(eq(visitorProducts.tenantId, tenantId), ne(visitorProducts.stock, "out")));

  // «سن لیست» = زمان آخرین ورود فایل همان ویزیتور (ردیف‌های واردشده از فایل)؛ اگر فایلی وارد نشده، آخرین تغییر
  const ages = await tx
    .select({
      visitorId: visitorProducts.visitorId,
      importedAt: sql<string | null>`max(${visitorProducts.updatedAt}) filter (where ${visitorProducts.lastImportId} is not null)`,
      anyAt: sql<string | null>`max(${visitorProducts.updatedAt})`,
    })
    .from(visitorProducts)
    .where(eq(visitorProducts.tenantId, tenantId))
    .groupBy(visitorProducts.visitorId);
  const ageBy = new Map<string, string | null>();
  for (const a of ages) {
    const v = a.importedAt ?? a.anyAt;
    ageBy.set(a.visitorId, v ? new Date(v).toISOString() : null);
  }

  const entries: SearchEntry[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokens: tokenize(normalizeText(r.name)),
    visitorId: r.visitorId,
    visitorName: r.visitorName,
    price: r.price,
    qty: r.qty === null || r.qty === undefined ? null : Number(r.qty),
    unit: r.unit,
    stock: r.stock,
    listAt: ageBy.get(r.visitorId) ?? null,
  }));
  setCachedEntries(tenantId, entries);
  return entries;
}

/**
 * جستجوی سراسری — از هر صفحه‌ای در دسترس است. فقط بازیابی اطلاعات است،
 * هیچ تحلیل یا قضاوتی روی نتایج انجام نمی‌شود.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({ visitors: [], products: [], notes: [] });
    }
    const like = `%${q}%`;

    const data = await withTenant(ctx, async (tx) => {
      const [visitorRows, productRows, noteRows] = await Promise.all([
        tx
          .select({
            id: visitors.id,
            name: visitors.name,
            company: visitors.company,
          })
          .from(visitors)
          .where(
            and(
              eq(visitors.tenantId, ctx.tenantId),
              or(ilike(visitors.name, like), ilike(visitors.company, like))
            )
          )
          .limit(8),

        loadEntries(tx, ctx.tenantId).then((entries) => searchEntries(entries, q)),

        tx
          .select({ id: quickNotes.id, body: quickNotes.body })
          .from(quickNotes)
          .where(
            and(eq(quickNotes.tenantId, ctx.tenantId), ilike(quickNotes.body, like))
          )
          .limit(8),
      ]);
      return { visitors: visitorRows, products: productRows, notes: noteRows };
    });

    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/search", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
