import { NextResponse } from "next/server";
import { eq, and, asc, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import {
  visitors,
  visitorNotes,
  visitorProducts,
  visitorProductHistory,
  products,
  catalogFiles,
  profiles,
} from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [
        visitorRows,
        noteRows,
        conditionRows,
        productRows,
        historyRows,
        catalogRows,
        profileRow,
      ] = await Promise.all([
          tx
            .select({
              id: visitors.id,
              name: visitors.name,
              company: visitors.company,
              phone: visitors.phone,
              messengerUsername: visitors.messengerUsername,
              createdAt: visitors.createdAt,
            })
            .from(visitors)
            .where(eq(visitors.tenantId, ctx.tenantId))
            .orderBy(asc(visitors.name)),
          tx
            .select({
              id: visitorNotes.id,
              visitorId: visitorNotes.visitorId,
              body: visitorNotes.body,
              createdAt: visitorNotes.createdAt,
            })
            .from(visitorNotes)
            .where(eq(visitorNotes.tenantId, ctx.tenantId))
            .orderBy(desc(visitorNotes.createdAt))
            .limit(300),
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
              updatedAt: visitorProducts.updatedAt,
              productName: products.name,
              productCode: products.code,
            })
            .from(visitorProducts)
            .innerJoin(products, eq(visitorProducts.productId, products.id))
            .where(eq(visitorProducts.tenantId, ctx.tenantId)),
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
          tx
            .select({
              id: catalogFiles.id,
              visitorId: catalogFiles.visitorId,
              fileName: catalogFiles.fileName,
              mimeType: catalogFiles.mimeType,
              sizeBytes: catalogFiles.sizeBytes,
              status: catalogFiles.status,
              createdAt: catalogFiles.createdAt,
            })
            .from(catalogFiles)
            .where(eq(catalogFiles.tenantId, ctx.tenantId))
            .orderBy(desc(catalogFiles.createdAt))
            .limit(50),
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
        visitors: visitorRows,
        notes: noteRows,
        conditions: conditionRows,
        products: productRows,
        history: historyRows,
        catalogs: catalogRows,
        profile: profileRow[0] ?? null,
        role: ctx.role,
      };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/visitors", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
