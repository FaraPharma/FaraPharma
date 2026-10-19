import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import {
  visitorProductHistory,
  products,
  visitors,
  cheques,
} from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * تاریخچه‌ی یکپارچه تنانت:
 *  - conditionEvents: هر تغییر قیمت/شرایط (اسنپ‌شات قبل از تغییر)
 *  - chequeEvents: ثبت و تسویه‌ی چک‌ها
 */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [condRows, chequeRows] = await Promise.all([
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
            price: visitorProductHistory.price,
            recordedAt: visitorProductHistory.recordedAt,
            visitorName: visitors.name,
            productName: products.name,
          })
          .from(visitorProductHistory)
          .innerJoin(visitors, eq(visitorProductHistory.visitorId, visitors.id))
          .innerJoin(products, eq(visitorProductHistory.productId, products.id))
          .where(eq(visitorProductHistory.tenantId, ctx.tenantId))
          .orderBy(desc(visitorProductHistory.recordedAt))
          .limit(200),
        tx
          .select({
            id: cheques.id,
            visitorName: cheques.visitorName,
            amount: cheques.amount,
            dueDate: cheques.dueDate,
            settled: cheques.settled,
            settledAt: cheques.settledAt,
            createdAt: cheques.createdAt,
          })
          .from(cheques)
          .where(eq(cheques.tenantId, ctx.tenantId))
          .orderBy(desc(cheques.createdAt))
          .limit(200),
      ]);
      return { conditionEvents: condRows, chequeEvents: chequeRows };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/history", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
