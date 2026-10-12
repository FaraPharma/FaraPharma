"use server";

import { eq, and } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import {
  priceRequests,
  priceRequestItems,
  priceResponses,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import type { ActionResult } from "@/actions/auth";

export async function createRequestAction(input: {
  productIds: string[];
  note?: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const ids = Array.from(new Set((input.productIds ?? []).filter(Boolean)));
  if (ids.length === 0)
    return { ok: false, error: "حداقل یک کالا انتخاب کنید" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const inserted = await tx
        .insert(priceRequests)
        .values({
          tenantId: ctx.tenantId,
          status: "open",
          note: input.note?.trim() || null,
        })
        .returning({ id: priceRequests.id });
      const requestId = inserted[0].id;
      for (const productId of ids.slice(0, 30)) {
        await tx.insert(priceRequestItems).values({
          tenantId: ctx.tenantId,
          requestId,
          productId,
        });
      }
      return { ok: true, id: requestId };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Registers/updates the responses of ONE visitor for EVERY product of a
 * price request — each (visitor × product) pair is its own row, so a
 * multi-product request gets a separate response per product.
 */
export async function addResponsesAction(input: {
  requestId: string;
  visitorId: string;
  responses: Array<{
    productId: string;
    price?: number;
    stock?: string;
    checkDays?: number;
    cashDiscountPct?: number;
    offer?: string;
  }>;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  if (!input.visitorId) return { ok: false, error: "ویزیتور انتخاب نشده است" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const reqRows = await tx
        .select({ id: priceRequests.id })
        .from(priceRequests)
        .where(
          and(
            eq(priceRequests.id, input.requestId),
            eq(priceRequests.tenantId, ctx.tenantId)
          )
        )
        .limit(1);
      if (!reqRows[0]) return { ok: false, error: "درخواست قیمت یافت نشد" };

      // only products that actually belong to this request are accepted
      const itemRows = await tx
        .select({ productId: priceRequestItems.productId })
        .from(priceRequestItems)
        .where(
          and(
            eq(priceRequestItems.requestId, input.requestId),
            eq(priceRequestItems.tenantId, ctx.tenantId)
          )
        );
      const validIds = new Set(itemRows.map((r) => r.productId));
      const valid = (input.responses ?? []).filter((r) =>
        validIds.has(r.productId)
      );
      if (valid.length === 0)
        return { ok: false, error: "کالای معتبری برای این درخواست انتخاب نشده" };

      const respondedAt = new Date();
      for (const r of valid) {
        const values = {
          tenantId: ctx.tenantId,
          requestId: input.requestId,
          visitorId: input.visitorId,
          productId: r.productId,
          price: r.price ? Math.max(0, Math.round(r.price)) : null,
          stock: r.stock || null,
          checkDays: r.checkDays
            ? Math.max(0, Math.round(r.checkDays))
            : null,
          cashDiscountPct: r.cashDiscountPct
            ? Math.max(0, Math.min(100, Math.round(r.cashDiscountPct)))
            : null,
          offer: r.offer?.trim() || null,
          respondedAt,
        };
        await tx
          .insert(priceResponses)
          .values(values)
          .onConflictDoUpdate({
            target: [
              priceResponses.tenantId,
              priceResponses.requestId,
              priceResponses.visitorId,
              priceResponses.productId,
            ],
            set: {
              price: values.price,
              stock: values.stock,
              checkDays: values.checkDays,
              cashDiscountPct: values.cashDiscountPct,
              offer: values.offer,
              respondedAt: values.respondedAt,
            },
          });
      }
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function toggleRequestAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const rows = await tx
        .select({ status: priceRequests.status })
        .from(priceRequests)
        .where(and(eq(priceRequests.id, id), eq(priceRequests.tenantId, ctx.tenantId)))
        .limit(1);
      if (!rows[0]) return;
      await tx
        .update(priceRequests)
        .set({ status: rows[0].status === "open" ? "closed" : "open" })
        .where(and(eq(priceRequests.id, id), eq(priceRequests.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteRequestAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .delete(priceRequests)
        .where(and(eq(priceRequests.id, id), eq(priceRequests.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
