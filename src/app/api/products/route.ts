import { NextResponse } from "next/server";
import { eq, and, asc, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import {
  products,
  visitors,
  visitorProducts,
  visitorProductHistory,
} from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [
        productRows,
        conditionRows,
        visitorRows,
        historyRows,
      ] = await Promise.all([
        tx
          .select({
            id: products.id,
            name: products.name,
            code: products.code,
            category: products.category,
            isShort: products.isShort,
            shortAt: products.shortAt,
            createdAt: products.createdAt,
          })
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true)))
          .orderBy(asc(products.name)),
          tx
            .select({
              id: visitorProducts.id,
              visitorId: visitorProducts.visitorId,
              productId: visitorProducts.productId,
              stock: visitorProducts.stock,
              cashDiscountPct: visitorProducts.cashDiscountPct,
              checkDays: visitorProducts.checkDays,
              offer: visitorProducts.offer,
              validUntil: visitorProducts.validUntil,
              price: visitorProducts.price,
              visitorName: visitors.name,
              visitorCompany: visitors.company,
              visitorPhone: visitors.phone,
            })
            .from(visitorProducts)
            .innerJoin(visitors, eq(visitorProducts.visitorId, visitors.id))
            .where(eq(visitorProducts.tenantId, ctx.tenantId)),
        tx
          .select({
            id: visitors.id,
            name: visitors.name,
            company: visitors.company,
            phone: visitors.phone,
          })
          .from(visitors)
          .where(eq(visitors.tenantId, ctx.tenantId))
          .orderBy(asc(visitors.name)),
        tx
          .select({
            id: visitorProductHistory.id,
            visitorId: visitorProductHistory.visitorId,
            productId: visitorProductHistory.productId,
            stock: visitorProductHistory.stock,
            cashDiscountPct: visitorProductHistory.cashDiscountPct,
            checkDays: visitorProductHistory.checkDays,
            offer: visitorProductHistory.offer,
            validUntil: visitorProductHistory.validUntil,
            recordedAt: visitorProductHistory.recordedAt,
          })
            .from(visitorProductHistory)
            .where(eq(visitorProductHistory.tenantId, ctx.tenantId))
            .orderBy(desc(visitorProductHistory.recordedAt))
            .limit(600),
      ]);
      return {
        products: productRows,
        conditions: conditionRows,
        visitors: visitorRows,
        history: historyRows,
      };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/products", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
