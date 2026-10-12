import { NextResponse } from "next/server";
import { eq, and, asc, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import {
  priceRequests,
  priceRequestItems,
  priceResponses,
  products,
  visitors,
} from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [requestRows, itemRows, responseRows, productRows, visitorRows] =
        await Promise.all([
          tx
            .select({
              id: priceRequests.id,
              status: priceRequests.status,
              note: priceRequests.note,
              createdAt: priceRequests.createdAt,
            })
            .from(priceRequests)
            .where(eq(priceRequests.tenantId, ctx.tenantId))
            .orderBy(desc(priceRequests.createdAt)),
          tx
            .select({
              requestId: priceRequestItems.requestId,
              productId: priceRequestItems.productId,
              productName: products.name,
            })
            .from(priceRequestItems)
            .innerJoin(products, eq(priceRequestItems.productId, products.id))
            .where(eq(priceRequestItems.tenantId, ctx.tenantId)),
          tx
            .select({
              id: priceResponses.id,
              requestId: priceResponses.requestId,
              visitorId: priceResponses.visitorId,
              productId: priceResponses.productId,
              productName: products.name,
              price: priceResponses.price,
              stock: priceResponses.stock,
              checkDays: priceResponses.checkDays,
              cashDiscountPct: priceResponses.cashDiscountPct,
              offer: priceResponses.offer,
              respondedAt: priceResponses.respondedAt,
              visitorName: visitors.name,
              visitorCompany: visitors.company,
            })
            .from(priceResponses)
            .innerJoin(visitors, eq(priceResponses.visitorId, visitors.id))
            .innerJoin(products, eq(priceResponses.productId, products.id))
            .where(eq(priceResponses.tenantId, ctx.tenantId)),
          tx
            .select({
              id: products.id,
              name: products.name,
              code: products.code,
              category: products.category,
            })
            .from(products)
            .where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true)))
            .orderBy(asc(products.name)),
          tx
            .select({
              id: visitors.id,
              name: visitors.name,
              company: visitors.company,
              phone: visitors.phone,
              messengerUsername: visitors.messengerUsername,
            })
            .from(visitors)
            .where(eq(visitors.tenantId, ctx.tenantId))
            .orderBy(asc(visitors.name)),
        ]);
      return {
        requests: requestRows,
        items: itemRows,
        responses: responseRows,
        products: productRows,
        visitors: visitorRows,
      };
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
