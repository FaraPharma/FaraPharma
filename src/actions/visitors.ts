"use server";

import { eq, and, inArray, sql } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { normalizeUsername } from "@/lib/domain";
import {
  visitors,
  visitorNotes,
  visitorProducts,
  visitorProductHistory,
  products,
  orders,
  basketItems,
  priceRequestItems,
  priceResponses,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import type { ActionResult } from "@/actions/auth";

export async function addVisitorAction(input: {
  name: string;
  company?: string;
  phone?: string;
  messengerUsername?: string;
  mainProducts?: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const name = (input.name ?? "").trim();
  if (name.length < 2) return { ok: false, error: "نام ویزیتور را وارد کنید" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const inserted = await tx
        .insert(visitors)
        .values({
          tenantId: ctx.tenantId,
          name,
          company: input.company?.trim() || null,
          phone: input.phone?.trim() || null,
          messengerUsername: normalizeUsername(
            input.messengerUsername
          ) || null,
        })
        .returning({ id: visitors.id });
      const visitorId = inserted[0].id;

      // Quick-add main products: create missing products and link with
      // default "in stock" conditions.
      const names = (input.mainProducts ?? "")
        .split(/[،,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 6);
      for (const pname of names) {
        const found = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), eq(products.name, pname)))
          .limit(1);
        let productId = found[0]?.id;
        if (!productId) {
          const created = await tx
            .insert(products)
            .values({
              tenantId: ctx.tenantId,
              name: pname,
              category: "cosmetic",
            })
            .returning({ id: products.id });
          productId = created[0].id;
        }
        await tx
          .insert(visitorProducts)
          .values({
            tenantId: ctx.tenantId,
            visitorId,
            productId,
            stock: "in",
            cashDiscountPct: 0,
            checkDays: 0,
          })
          .onConflictDoNothing();
      }
      return { ok: true, id: visitorId };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateVisitorAction(input: {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  messengerUsername?: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const name = (input.name ?? "").trim();
  if (name.length < 2) return { ok: false, error: "نام ویزیتور را وارد کنید" };
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(visitors)
        .set({
          name,
          company: input.company?.trim() || null,
          phone: input.phone?.trim() || null,
          messengerUsername: normalizeUsername(
            input.messengerUsername
          ) || null,
          updatedAt: new Date(),
        })
        .where(and(eq(visitors.id, input.id), eq(visitors.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

const VISITOR_TERMS_MAX = 500;

/** یادداشت آفر و شرایط پرداخت ویزیتور: فقط ذخیره (متن آزاد، حداکثر ۵۰۰ نویسه؛ خالی = پاک) */
export async function updateVisitorTermsAction(input: { id: string; note: string }): Promise<ActionResult> {
  const ctx = await requireAuth();
  const note = String(input.note ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if ([...note].length > VISITOR_TERMS_MAX) {
    return { ok: false, error: `یادداشت حداکثر ${VISITOR_TERMS_MAX} نویسه می‌تواند باشد` };
  }
  try {
    const r = await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      return tx
        .update(visitors)
        .set({ noteTerms: note === "" ? null : note, updatedAt: new Date() })
        .where(and(eq(visitors.id, input.id), eq(visitors.tenantId, ctx.tenantId)))
        .returning({ id: visitors.id });
    });
    if (!r[0]) return { ok: false, error: "ویزیتور یافت نشد" };
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export interface DeleteVisitorResult extends ActionResult {
  /** کالاهایی که فقط همین ویزیتور داشت و همراهش پاک شد */
  removedProducts?: number;
}

/**
 * حذف ویزیتور. کالاهایی که فقط همین ویزیتور داشت و دیگر هیچ ویزیتوری ندارند هم پاک می‌شوند، به‌جز کالایی که
 * در کسری‌هاست، در لیست خرید است یا در درخواست قیمت استفاده شده (آن‌ها می‌مانند تا چیزی از کاربر گم نشود).
 */
export async function deleteVisitorAction(id: string): Promise<DeleteVisitorResult> {
  const ctx = await requireAuth();
  try {
    const removed = await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      // سفارش‌ها (حتی داخل سطل بازیافت) با حذف ویزیتور برای همیشه پاک می‌شدند
      const hasOrders = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.visitorId, id), eq(orders.tenantId, ctx.tenantId)))
        .limit(1);
      if (hasOrders.length > 0) {
        throw new AppError(
          "این ویزیتور سفارش ثبت‌شده دارد و حذف نمی‌شود. اگر واقعاً لازم است، ابتدا سفارش‌های او را (از جمله سطل بازیافت) حذف نهایی کنید.",
          409
        );
      }
      // کالاهای این ویزیتور را قبل از حذف (که ردیف‌هایشان را هم پاک می‌کند) یادداشت کن
      const mine = await tx
        .select({ productId: visitorProducts.productId })
        .from(visitorProducts)
        .where(and(eq(visitorProducts.visitorId, id), eq(visitorProducts.tenantId, ctx.tenantId)));
      const candidateIds = [...new Set(mine.map((m) => m.productId))];
      await tx
        .delete(visitors)
        .where(and(eq(visitors.id, id), eq(visitors.tenantId, ctx.tenantId)));
      if (candidateIds.length === 0) return 0;
      const gone = await tx
        .delete(products)
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            inArray(products.id, candidateIds),
            eq(products.isShort, false),
            sql`NOT EXISTS (SELECT 1 FROM ${visitorProducts} WHERE ${visitorProducts.productId} = ${products.id})`,
            sql`NOT EXISTS (SELECT 1 FROM ${visitorProductHistory} WHERE ${visitorProductHistory.productId} = ${products.id})`,
            sql`NOT EXISTS (SELECT 1 FROM ${basketItems} WHERE ${basketItems.productId} = ${products.id})`,
            sql`NOT EXISTS (SELECT 1 FROM ${priceRequestItems} WHERE ${priceRequestItems.productId} = ${products.id})`,
            sql`NOT EXISTS (SELECT 1 FROM ${priceResponses} WHERE ${priceResponses.productId} = ${products.id})`
          )
        )
        .returning({ id: products.id });
      return gone.length;
    });
    return { ok: true, removedProducts: removed };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function addVisitorNoteAction(input: {
  visitorId: string;
  body: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "متن یادداشت را وارد کنید" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const inserted = await tx
        .insert(visitorNotes)
        .values({
          tenantId: ctx.tenantId,
          visitorId: input.visitorId,
          body,
        })
        .returning({ id: visitorNotes.id });
      return { ok: true, id: inserted[0].id };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteVisitorNoteAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .delete(visitorNotes)
        .where(and(eq(visitorNotes.id, id), eq(visitorNotes.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function setConditionAction(input: {
  visitorId: string;
  productId: string;
  stock: string;
  cashDiscountPct: number;
  checkDays: number;
  offer?: string;
  validUntil?: string;
  price?: number;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const values = {
        tenantId: ctx.tenantId,
        visitorId: input.visitorId,
        productId: input.productId,
        stock: input.stock,
        cashDiscountPct: Math.max(0, Math.min(100, Number(input.cashDiscountPct) || 0)),
        checkDays: Math.max(0, Math.min(365, Number(input.checkDays) || 0)),
        offer: input.offer?.trim() || null,
        validUntil: input.validUntil?.trim() ? input.validUntil.trim() : null,
        price:
          input.price !== undefined && input.price !== null && input.price > 0
            ? Math.round(input.price)
            : null,
        updatedAt: new Date(),
      };

      // History snapshot: the previous state of this condition is recorded
      // (with its timestamp) before the overwrite happens.
      const previous = await tx
        .select({
          stock: visitorProducts.stock,
          cashDiscountPct: visitorProducts.cashDiscountPct,
          checkDays: visitorProducts.checkDays,
          offer: visitorProducts.offer,
          validUntil: visitorProducts.validUntil,
          price: visitorProducts.price,
        })
        .from(visitorProducts)
        .where(
          and(
            eq(visitorProducts.tenantId, ctx.tenantId),
            eq(visitorProducts.visitorId, input.visitorId),
            eq(visitorProducts.productId, input.productId)
          )
        )
        .limit(1);
      if (previous[0]) {
        await tx.insert(visitorProductHistory).values({
          tenantId: ctx.tenantId,
          visitorId: input.visitorId,
          productId: input.productId,
          stock: previous[0].stock,
          cashDiscountPct: previous[0].cashDiscountPct,
          checkDays: previous[0].checkDays,
          offer: previous[0].offer,
          validUntil: previous[0].validUntil,
          price: previous[0].price,
          recordedAt: new Date(),
        });
      }

      await tx
        .insert(visitorProducts)
        .values(values)
        .onConflictDoUpdate({
          target: [
            visitorProducts.tenantId,
            visitorProducts.visitorId,
            visitorProducts.productId,
          ],
          set: {
            stock: values.stock,
            cashDiscountPct: values.cashDiscountPct,
            checkDays: values.checkDays,
            offer: values.offer,
            validUntil: values.validUntil,
            price: values.price,
            updatedAt: values.updatedAt,
          },
        });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteConditionAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .delete(visitorProducts)
        .where(and(eq(visitorProducts.id, id), eq(visitorProducts.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
