import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, or } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { visitors, products, visitorProducts, quickNotes } from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

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

        tx
          .select({
            conditionId: visitorProducts.id,
            productName: products.name,
            visitorId: visitors.id,
            visitorName: visitors.name,
            price: visitorProducts.price,
          })
          .from(visitorProducts)
          .innerJoin(products, eq(visitorProducts.productId, products.id))
          .innerJoin(visitors, eq(visitorProducts.visitorId, visitors.id))
          .where(
            and(
              eq(visitorProducts.tenantId, ctx.tenantId),
              ilike(products.name, like)
            )
          )
          .limit(10),

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
