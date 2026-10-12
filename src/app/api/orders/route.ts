import { NextResponse } from "next/server";
import { eq, asc, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import {
  orders,
  orderItems,
  visitors,
  products,
  profiles,
} from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [orderRows, itemRows, visitorRows, productRows, profileRow] = await Promise.all([
        tx
          .select({
            id: orders.id,
            visitorId: orders.visitorId,
            status: orders.status,
            note: orders.note,
            settlementType: orders.settlementType,
            settlementDays: orders.settlementDays,
            createdAt: orders.createdAt,
            visitorName: visitors.name,
            visitorCompany: visitors.company,
          })
          .from(orders)
          .leftJoin(visitors, eq(orders.visitorId, visitors.id))
          .where(eq(orders.tenantId, ctx.tenantId))
          .orderBy(desc(orders.createdAt)),
        tx
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            productName: orderItems.productName,
            qty: orderItems.qty,
            unitPrice: orderItems.unitPrice,
            discountPct: orderItems.discountPct,
          })
          .from(orderItems)
          .where(eq(orderItems.tenantId, ctx.tenantId))
          .orderBy(asc(orderItems.id)),
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
            id: products.id,
            name: products.name,
          })
          .from(products)
          .where(eq(products.tenantId, ctx.tenantId))
          .orderBy(asc(products.name)),
        tx
          .select({
            id: profiles.id,
            name: profiles.name,
            phone: profiles.phone,
            status: profiles.status,
            trialEndsAt: profiles.trialEndsAt,
            subscriptionEndsAt: profiles.subscriptionEndsAt,
            createdAt: profiles.createdAt,
          })
          .from(profiles)
          .where(eq(profiles.id, ctx.tenantId))
          .limit(1),
      ]);
      return {
        orders: orderRows,
        items: itemRows,
        visitors: visitorRows,
        products: productRows,
        pharmacyName: profileRow[0]?.name ?? null,
        profile: profileRow[0] ?? null,
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
