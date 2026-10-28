import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { basketItems } from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/** تعداد ردیف‌های لیست خرید (برای نشان روی نوار پایین) — سبک و بدون جزئیات */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const n = await withTenant(ctx, async (tx) => {
      const r = await tx.select({ n: count() }).from(basketItems).where(eq(basketItems.tenantId, ctx.tenantId));
      return Number(r[0]?.n ?? 0);
    });
    return NextResponse.json({ count: n });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/basket/count", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطای سرور" }, { status });
  }
}
