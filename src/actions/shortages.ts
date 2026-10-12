"use server";

import { and, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { products } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import type { ActionResult } from "@/actions/auth";

export interface ShortageResult extends ActionResult {
  short?: boolean;
}

/**
 * Sets/clears the «کسری دارم» flag of a tenant product. shortAt records
 * the marking time so the shortages list can be ordered by it.
 */
export async function setShortageAction(input: {
  productId: string;
  short: boolean;
}): Promise<ShortageResult> {
  const ctx = await requireAuth();
  if (!input.productId) return { ok: false, error: "کالا انتخاب نشده است" };
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const rows = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId))
        )
        .limit(1);
      if (!rows[0]) throw new AppError("کالا یافت نشد", 404);
      await tx
        .update(products)
        .set({
          isShort: input.short,
          shortAt: input.short ? new Date() : null,
        })
        .where(
          and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId))
        );
    });
    return { ok: true, short: input.short };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
