"use server";

import { eq, and, inArray } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { orders, orderItems, products } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { ORDER_STATUS } from "@/lib/config";
import type { ActionResult } from "@/actions/auth";

export interface OrderItemInput {
  productName: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
}

export async function createOrderAction(input: {
  visitorId: string;
  note?: string;
  settlementType?: "cash" | "cheque";
  settlementDays?: number;
  items: OrderItemInput[];
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  if (!input.visitorId) return { ok: false, error: "ویزیتور را انتخاب کنید" };
  const settlementType: "cash" | "cheque" =
    input.settlementType === "cheque" ? "cheque" : "cash";
  const settlementDays = Math.max(0, Math.round(Number(input.settlementDays) || 0));
  const items = (input.items ?? [])
    .map((it) => ({
      productName: (it.productName ?? "").trim(),
      qty: Math.max(1, Math.round(Number(it.qty) || 1)),
      unitPrice: Math.max(0, Math.round(Number(it.unitPrice) || 0)),
      discountPct: Math.max(0, Math.min(100, Math.round(Number(it.discountPct) || 0))),
    }))
    .filter((it) => it.productName.length > 0);
  if (items.length === 0)
    return { ok: false, error: "حداقل یک قلم کالا اضافه کنید" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const inserted = await tx
        .insert(orders)
        .values({
          tenantId: ctx.tenantId,
          visitorId: input.visitorId,
          status: "registered",
          note: input.note?.trim() || null,
          settlementType,
          settlementDays,
        })
        .returning({ id: orders.id });
      const orderId = inserted[0].id;
      for (const it of items) {
        await tx.insert(orderItems).values({
          tenantId: ctx.tenantId,
          orderId,
          productName: it.productName,
          qty: it.qty,
          unitPrice: it.unitPrice,
          discountPct: it.discountPct,
        });
      }

      // ثبت سفارش برای یک کالا، کسری آن را بهصورت خودکار رفع میکند
      const itemNames = items.map((it) => it.productName);
      if (itemNames.length > 0) {
        await tx
          .update(products)
          .set({ isShort: false, shortAt: null })
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              inArray(products.name, itemNames)
            )
          );
      }
      return { ok: true, id: orderId };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function setOrderStatusAction(
  id: string,
  status: string
): Promise<ActionResult> {
  const ctx = await requireAuth();
  if (!(status in ORDER_STATUS))
    return { ok: false, error: "وضعیت معتبر نیست" };
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(orders)
        .set({ status })
        .where(and(eq(orders.id, id), eq(orders.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .delete(orders)
        .where(and(eq(orders.id, id), eq(orders.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
