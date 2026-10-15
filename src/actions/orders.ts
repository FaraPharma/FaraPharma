"use server";

import { eq, and, inArray, isNull, isNotNull, sql } from "drizzle-orm";
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

/** کلید ثبت یکتا: فقط حروف/عدد/خط‌تیره/زیرخط، ۸ تا ۶۴ نویسه */
const CLIENT_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function createOrderAction(input: {
  clientKey?: string;
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
  const clientKey =
    typeof input.clientKey === "string" && CLIENT_KEY_RE.test(input.clientKey)
      ? input.clientKey
      : null;
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);

      // قفل ردیفِ شمارنده‌ی همین داروخانه تا پایان تراکنش: ثبت‌های همزمان
      // پشت‌سرهم اجرا می‌شوند، پس نه شماره‌ی تکراری می‌سازند و نه کلید تکراری.
      await tx.execute(
        sql`INSERT INTO order_counters (tenant_id, last_no) VALUES (${ctx.tenantId}, 0) ON CONFLICT (tenant_id) DO NOTHING`
      );
      await tx.execute(
        sql`SELECT last_no FROM order_counters WHERE tenant_id = ${ctx.tenantId} FOR UPDATE`
      );

      // ثبت مجدد با همان کلید (دوبار لمس، تلاش دوباره): همان سفارش قبلی برگردد
      if (clientKey) {
        const existing = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(eq(orders.tenantId, ctx.tenantId), eq(orders.clientKey, clientKey))
          )
          .limit(1);
        if (existing[0]) return { ok: true, id: existing[0].id };
      }

      // شماره‌ی بعدی؛ اگر تراکنش برگردد این افزایش هم برمی‌گردد (بدون شماره‌ی سوخته)
      const bumped = await tx.execute(
        sql`UPDATE order_counters SET last_no = last_no + 1 WHERE tenant_id = ${ctx.tenantId} RETURNING last_no`
      );
      const orderNo = Number(
        (bumped.rows as Array<{ last_no: number }>)[0]?.last_no
      );
      if (!Number.isInteger(orderNo) || orderNo < 1) {
        throw new Error("تخصیص شماره‌ی سفارش ناموفق بود");
      }

      const inserted = await tx
        .insert(orders)
        .values({
          tenantId: ctx.tenantId,
          orderNo,
          clientKey,
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
        .where(
          and(
            eq(orders.id, id),
            eq(orders.tenantId, ctx.tenantId),
            isNull(orders.deletedAt)
          )
        );
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** حذف نرم: فقط deletedAt پر می‌شود و هیچ ردیفی پاک نمی‌شود */
export async function deleteOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(orders)
        .set({ deletedAt: sql`now()` })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.tenantId, ctx.tenantId),
            isNull(orders.deletedAt)
          )
        );
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** بازگردانی از سطل بازیافت */
export async function restoreOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const rows = await tx
        .update(orders)
        .set({ deletedAt: null })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.tenantId, ctx.tenantId),
            isNotNull(orders.deletedAt)
          )
        )
        .returning({ id: orders.id });
      if (rows.length === 0)
        return { ok: false, error: "این سفارش در سطل بازیافت نیست" };
      return { ok: true, id };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** حذف نهایی؛ فقط برای سفارشی که از قبل در سطل بازیافت است */
export async function purgeOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const rows = await tx
        .delete(orders)
        .where(
          and(
            eq(orders.id, id),
            eq(orders.tenantId, ctx.tenantId),
            isNotNull(orders.deletedAt)
          )
        )
        .returning({ id: orders.id });
      if (rows.length === 0)
        return { ok: false, error: "این سفارش در سطل بازیافت نیست" };
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
