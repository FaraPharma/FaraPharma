import { NextResponse } from "next/server";
import { eq, and, desc, isNotNull, isNull, sql } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import {
  profiles,
  visitors,
  products,
  orders,
  priceRequests,
  visitorProducts,
  cheques,
  quickNotes,
} from "@/db/schema";
import { TRIAL_DAYS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [profile] = await tx
        .select({
          id: profiles.id,
          name: profiles.name,
          phone: profiles.phone,
          status: profiles.status,
          trialEndsAt: profiles.trialEndsAt,
          subscriptionEndsAt: profiles.subscriptionEndsAt,
          chequeWarningDays: profiles.chequeWarningDays,
          createdAt: profiles.createdAt,
        })
        .from(profiles)
        .where(eq(profiles.id, ctx.tenantId))
        .limit(1);

      const [pCount, vCount, oCount, rCount, lowCount, shortCount] =
        await Promise.all([
        tx
          .select()
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true))),
        tx
          .select({ id: visitors.id })
          .from(visitors)
          .where(eq(visitors.tenantId, ctx.tenantId)),
        tx
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.tenantId, ctx.tenantId),
              eq(orders.status, "registered"),
              isNull(orders.deletedAt)
            )
          ),
        tx
          .select({ id: priceRequests.id })
          .from(priceRequests)
          .where(
            and(eq(priceRequests.tenantId, ctx.tenantId), eq(priceRequests.status, "open"))
          ),
        tx
          .select({ id: visitorProducts.id })
          .from(visitorProducts)
          .where(and(eq(visitorProducts.tenantId, ctx.tenantId), eq(visitorProducts.stock, "low"))),
        tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              eq(products.active, true),
              eq(products.isShort, true)
            )
          ),
      ]);

      const recentOrders = await tx
        .select({
          id: orders.id,
          createdAt: orders.createdAt,
          status: orders.status,
          visitorName: visitors.name,
          visitorCompany: visitors.company,
        })
        .from(orders)
        .leftJoin(visitors, eq(orders.visitorId, visitors.id))
        .where(and(eq(orders.tenantId, ctx.tenantId), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt))
        .limit(5);

      // ---------- خلاصه‌ی چک‌های پرداختی — سررسیدگذشته و نزدیک (۷ روز) ----------
      const todayStr = new Date().toISOString().slice(0, 10);
      const in7Str = new Date(Date.now() + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const openCheques = await tx
        .select({
          id: cheques.id,
          visitorName: cheques.visitorName,
          amount: cheques.amount,
          dueDate: cheques.dueDate,
        })
        .from(cheques)
        .where(
          and(eq(cheques.tenantId, ctx.tenantId), eq(cheques.settled, false))
        )
        .orderBy(cheques.dueDate);

      const overdueCheques = openCheques.filter((c) => c.dueDate < todayStr);
      const upcomingCheques = openCheques.filter(
        (c) => c.dueDate >= todayStr && c.dueDate <= in7Str
      );
      const chequesSummary = {
        overdueCount: overdueCheques.length,
        overdueTotal: overdueCheques.reduce((s, c) => s + c.amount, 0),
        upcomingCount: upcomingCheques.length,
        upcomingTotal: upcomingCheques.reduce((s, c) => s + c.amount, 0),
        nearest: openCheques.slice(0, 3),
      };

      // ---------- یادداشت‌های سریع ثبت‌شده (هنوز پردازش/تکمیل نشده) ----------
      const notes = await tx
        .select({
          id: quickNotes.id,
          body: quickNotes.body,
          createdAt: quickNotes.createdAt,
        })
        .from(quickNotes)
        .where(eq(quickNotes.tenantId, ctx.tenantId))
        .orderBy(desc(quickNotes.createdAt))
        .limit(5);

      const in7days = new Date(Date.now() + 7 * 86_400_000);
      const expiring = await tx
        .select({
          validUntil: visitorProducts.validUntil,
          offer: visitorProducts.offer,
          productName: products.name,
          visitorName: visitors.name,
        })
        .from(visitorProducts)
        .innerJoin(products, eq(visitorProducts.productId, products.id))
        .innerJoin(visitors, eq(visitorProducts.visitorId, visitors.id))
        .where(
          and(
            eq(visitorProducts.tenantId, ctx.tenantId),
            isNotNull(visitorProducts.offer)
          )
        )
        .limit(50);

      const data: Record<string, unknown> = {
        profile: profile ?? null,
        role: ctx.role,
        trialDays: TRIAL_DAYS,
        counts: {
          products: pCount.length,
          visitors: vCount.length,
          openOrders: oCount.length,
          openRequests: rCount.length,
          shortages: shortCount.length,
        },
        recentOrders,
        lowStockCount: lowCount.length,
        expiringOffers: expiring
          .filter((e) => e.validUntil && new Date(e.validUntil) <= in7days)
          .slice(0, 5),
        cheques: chequesSummary,
        quickNotes: notes,
      };

      return data;
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
