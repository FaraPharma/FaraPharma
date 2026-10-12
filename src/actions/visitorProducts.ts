"use server";

import { eq, and } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { products, visitorProducts } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import type { ActionResult } from "@/actions/auth";

export interface BulkVisitorProductsResult extends ActionResult {
  added?: number;
  skipped?: number;
  invalid?: number;
}

/**
 * ورود گروهی کالاهای یک ویزیتور (مثلاً از اکسل):
 * ستونها: نام کالا، قیمت، درصد نقدی، روزهای چک، آفر
 * برای هر ردیف، کالا در products ساخته (یا پیدا) و شرط همان ویزیتور
 * upsert میشود. ردیفهای تکراری/نامعتبر بدون خطا رد میشوند.
 */
export async function bulkAddVisitorProductsAction(input: {
  visitorId: string;
  items: Array<{
    name: string;
    price?: number;
    cashDiscountPct?: number;
    checkDays?: number;
    offer?: string;
  }>;
}): Promise<BulkVisitorProductsResult> {
  const ctx = await requireAuth();
  if (!input.visitorId)
    return { ok: false, error: "ویزیتور انتخاب نشده است" };

  const seen = new Set<string>();
  const items: Array<{
    name: string;
    price: number | null;
    cashDiscountPct: number;
    checkDays: number;
    offer: string | null;
  }> = [];
  let invalid = 0;
  for (const it of input.items ?? []) {
    const name = (it?.name ?? "").trim();
    if (name.length < 2) {
      invalid++;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    items.push({
      name,
      price: it.price && it.price > 0 ? Math.round(it.price) : null,
      cashDiscountPct: Math.max(
        0,
        Math.min(100, Math.round(Number(it.cashDiscountPct) || 0))
      ),
      checkDays: Math.max(0, Math.min(365, Math.round(Number(it.checkDays) || 0))),
      offer: it.offer?.trim() || null,
    });
  }
  if (items.length === 0)
    return { ok: false, error: "هیچ ردیف معتبری در فایل پیدا نشد", invalid };

  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      let added = 0;
      let skipped = 0;
      for (const it of items) {
        const found = await tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(eq(products.tenantId, ctx.tenantId), eq(products.name, it.name))
          )
          .limit(1);
        let productId = found[0]?.id;
        if (!productId) {
          const inserted = await tx
            .insert(products)
            .values({
              tenantId: ctx.tenantId,
              name: it.name,
              category: "cosmetic",
            })
            .returning({ id: products.id });
          productId = inserted[0].id;
          added++;
        } else {
          skipped++;
        }
        await tx
          .insert(visitorProducts)
          .values({
            tenantId: ctx.tenantId,
            visitorId: input.visitorId,
            productId,
            stock: "in",
            cashDiscountPct: it.cashDiscountPct,
            checkDays: it.checkDays,
            price: it.price,
            offer: it.offer,
          })
          .onConflictDoUpdate({
            target: [
              visitorProducts.tenantId,
              visitorProducts.visitorId,
              visitorProducts.productId,
            ],
            set: {
              cashDiscountPct: it.cashDiscountPct,
              checkDays: it.checkDays,
              price: it.price,
              offer: it.offer,
              updatedAt: new Date(),
            },
          });
      }
      return { ok: true, added, skipped, invalid };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, invalid };
    throw e;
  }
}
