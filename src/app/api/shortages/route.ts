import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { products } from "@/db/schema";

export const dynamic = "force-dynamic";

/** کالاهای کسری تنانت جاری، مرتب بر اساس آخرین زمان علامتگذاری */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const rows = await tx
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
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.active, true),
            eq(products.isShort, true)
          )
        )
        .orderBy(desc(products.shortAt), desc(products.createdAt))
        .limit(300);
      return { products: rows };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
