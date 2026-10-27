import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { basketItems, products, visitorProducts, visitors } from "@/db/schema";
import { logServerError } from "@/lib/log";
import { loadListAges } from "@/lib/list-age";
import { buildBasketItems } from "@/lib/basket";
import { loadLastPurchases } from "@/lib/purchase-history-db";

export const dynamic = "force-dynamic";

/** لیست خرید داروخانه‌ی جاری با جایگزین‌های هر کالا (ویزیتورهای دارای موجودی، قیمت و سن لیست) */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const items = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: basketItems.id,
          productId: basketItems.productId,
          productName: products.name,
          visitorId: basketItems.visitorId,
          visitorName: visitors.name,
          qty: basketItems.qty,
          price: basketItems.price,
        })
        .from(basketItems)
        .innerJoin(products, eq(basketItems.productId, products.id))
        .leftJoin(visitors, eq(basketItems.visitorId, visitors.id))
        .where(eq(basketItems.tenantId, ctx.tenantId))
        .orderBy(asc(basketItems.addedAt), asc(basketItems.id));
      if (rows.length === 0) return [];
      const visitorIds = [...new Set(rows.map((r) => r.visitorId).filter((v): v is string => v !== null))];
      const [available, listAt, last, noteRows] = await Promise.all([
        tx
          .select({
            productId: visitorProducts.productId,
            visitorId: visitorProducts.visitorId,
            visitorName: visitors.name,
            price: visitorProducts.price,
          })
          .from(visitorProducts)
          .innerJoin(visitors, eq(visitorProducts.visitorId, visitors.id))
          .where(
            and(
              eq(visitorProducts.tenantId, ctx.tenantId),
              inArray(visitorProducts.productId, rows.map((r) => r.productId)),
              ne(visitorProducts.stock, "out")
            )
          ),
        loadListAges(tx, ctx.tenantId),
        loadLastPurchases(tx, ctx.tenantId),
        visitorIds.length === 0
          ? Promise.resolve([] as Array<{ id: string; note: string | null }>)
          : tx
              .select({ id: visitors.id, note: visitors.noteTerms })
              .from(visitors)
              .where(and(eq(visitors.tenantId, ctx.tenantId), inArray(visitors.id, visitorIds), isNotNull(visitors.noteTerms))),
      ]);
      const notes = new Map<string, string | null>(noteRows.map((n) => [n.id, n.note]));
      return buildBasketItems(rows, available, listAt, Date.now(), { last, notes });
    });
    return NextResponse.json({ items });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/basket", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطای سرور" }, { status });
  }
}
