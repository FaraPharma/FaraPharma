import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import * as s from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Full tenant backup as a downloadable JSON document. Data is always stored
 * in the cloud database (automatic backup by design); this endpoint provides
 * an extra portable copy for resilience.
 */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [
        profile,
        visitors,
        notes,
        products,
        conditions,
        requests,
        items,
        responses,
        orders,
        orderItems,
        quickNotes,
        cheques,
        history,
        catalogs,
      ] = await Promise.all([
        tx
          .select({
            id: s.profiles.id,
            name: s.profiles.name,
            phone: s.profiles.phone,
            status: s.profiles.status,
            trialEndsAt: s.profiles.trialEndsAt,
            subscriptionEndsAt: s.profiles.subscriptionEndsAt,
            createdAt: s.profiles.createdAt,
          })
          .from(s.profiles)
          .where(eq(s.profiles.id, ctx.tenantId))
          .limit(1),
        tx.select().from(s.visitors).where(eq(s.visitors.tenantId, ctx.tenantId)),
        tx.select().from(s.visitorNotes).where(eq(s.visitorNotes.tenantId, ctx.tenantId)),
        tx.select().from(s.products).where(eq(s.products.tenantId, ctx.tenantId)),
        tx.select().from(s.visitorProducts).where(eq(s.visitorProducts.tenantId, ctx.tenantId)),
        tx.select().from(s.priceRequests).where(eq(s.priceRequests.tenantId, ctx.tenantId)),
        tx.select().from(s.priceRequestItems).where(eq(s.priceRequestItems.tenantId, ctx.tenantId)),
        tx.select().from(s.priceResponses).where(eq(s.priceResponses.tenantId, ctx.tenantId)),
        tx.select().from(s.orders).where(eq(s.orders.tenantId, ctx.tenantId)),
        tx.select().from(s.orderItems).where(eq(s.orderItems.tenantId, ctx.tenantId)),
        tx.select().from(s.quickNotes).where(eq(s.quickNotes.tenantId, ctx.tenantId)),
        tx.select().from(s.cheques).where(eq(s.cheques.tenantId, ctx.tenantId)),
        tx.select().from(s.visitorProductHistory).where(eq(s.visitorProductHistory.tenantId, ctx.tenantId)),
        tx
          .select({
            id: s.catalogFiles.id,
            visitorId: s.catalogFiles.visitorId,
            fileName: s.catalogFiles.fileName,
            mimeType: s.catalogFiles.mimeType,
            sizeBytes: s.catalogFiles.sizeBytes,
            status: s.catalogFiles.status,
            createdAt: s.catalogFiles.createdAt,
          })
          .from(s.catalogFiles)
          .where(eq(s.catalogFiles.tenantId, ctx.tenantId)),
      ]);
      return {
        meta: {
          app: "pharma-purchasing-assistant",
          version: 2,
          exportedAt: new Date().toISOString(),
        },
        profile: profile[0] ?? null,
        visitors,
        notes,
        products,
        conditions,
        requests,
        items,
        responses,
        orders,
        orderItems,
        quickNotes,
        cheques,
        history,
        catalogs,
      };
    });
    return NextResponse.json(data, {
      headers: {
        "Content-Disposition": 'attachment; filename="pharma-backup.json"',
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
