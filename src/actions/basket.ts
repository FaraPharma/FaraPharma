"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { AppError, withTenant, type Tx } from "@/db";
import { assertWritable } from "@/db/access";
import { basketItems, orders, products, visitorProducts, visitors } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { createOrderAction } from "@/actions/orders";
import { loadListAges } from "@/lib/list-age";
import { listAgeInfo } from "@/lib/product-search";
import { compareAlternatives, QTY_MAX } from "@/lib/basket";
import type { ActionResult } from "@/actions/auth";

export interface BasketActionResult extends ActionResult {
  updated?: boolean;
  added?: number;
  noVisitor?: number;
  alreadyIn?: number;
  orderNo?: number;
  duplicate?: boolean;
}

const CLIENT_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

function cleanQty(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= QTY_MAX ? n : null;
}

/** ویزیتورهایی که کالا را «موجود» دارند (stock != out) برای مجموعه‌ای از کالاها */
async function availableFor(tx: Tx, tenantId: string, productIds: string[]) {
  if (productIds.length === 0) return [];
  return tx
    .select({
      productId: visitorProducts.productId,
      visitorId: visitorProducts.visitorId,
      visitorName: visitors.name,
      price: visitorProducts.price,
    })
    .from(visitorProducts)
    .innerJoin(visitors, eq(visitorProducts.visitorId, visitors.id))
    .where(
      and(
        eq(visitorProducts.tenantId, tenantId),
        inArray(visitorProducts.productId, productIds),
        ne(visitorProducts.stock, "out")
      )
    );
}

async function guard<T extends BasketActionResult>(fn: () => Promise<T>): Promise<BasketActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** افزودن از نتایج جستجو: ردیفِ همان ویزیتور (conditionId = شناسه‌ی visitor_products). قیمت لحظه‌ی افزودن ذخیره می‌شود. */
export async function addToBasketAction(input: { conditionId: string; qty?: number }): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  if (!input.conditionId) return { ok: false, error: "کالا انتخاب نشده است" };
  const qty = input.qty === undefined ? 1 : cleanQty(input.qty);
  if (qty === null) return { ok: false, error: `تعداد باید عددی بین ۱ و ${QTY_MAX} باشد` };
  return guard(() =>
    withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const vp = (
        await tx
          .select({
            productId: visitorProducts.productId,
            productName: products.name,
            visitorId: visitorProducts.visitorId,
            price: visitorProducts.price,
            stock: visitorProducts.stock,
          })
          .from(visitorProducts)
          .innerJoin(products, eq(visitorProducts.productId, products.id))
          .where(and(eq(visitorProducts.id, input.conditionId), eq(visitorProducts.tenantId, ctx.tenantId)))
          .limit(1)
      )[0];
      if (!vp) throw new AppError("کالا یافت نشد", 404);
      if (vp.stock === "out") throw new AppError("این کالا نزد این ویزیتور ناموجود است", 400);
      const existing = (
        await tx
          .select({ id: basketItems.id })
          .from(basketItems)
          .where(and(eq(basketItems.tenantId, ctx.tenantId), eq(basketItems.productId, vp.productId)))
          .limit(1)
      )[0];
      const rows = await tx
        .insert(basketItems)
        .values({
          tenantId: ctx.tenantId,
          productId: vp.productId,
          productName: vp.productName,
          visitorId: vp.visitorId,
          qty,
          price: vp.price,
        })
        // کالا از قبل در لیست است: ویزیتور و قیمت به همین ردیف تغییر می‌کند، تعدادِ قبلی می‌ماند
        .onConflictDoUpdate({
          target: [basketItems.tenantId, basketItems.productId],
          set: { visitorId: vp.visitorId, price: vp.price, productName: vp.productName },
        })
        .returning({ id: basketItems.id });
      return { ok: true, id: rows[0].id, updated: Boolean(existing) };
    })
  );
}

/**
 * افزودن همه‌ی کسری‌ها: برای هر کالای کسری، ارزان‌ترین ویزیتورِ دارای موجودی (هم‌قیمت: لیست تازه‌تر).
 * اگر هیچ ویزیتوری موجود نبود، همان کالا بدون ویزیتور (ناموجود نزد همه). کالایی که از قبل در لیست است دست نمی‌خورد.
 */
export async function addAllShortagesAction(): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  return guard(() =>
    withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const shorts = await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.active, true), eq(products.isShort, true)))
        .limit(500);
      if (shorts.length === 0) return { ok: true, added: 0, noVisitor: 0, alreadyIn: 0 };
      const already = new Set(
        (
          await tx
            .select({ productId: basketItems.productId })
            .from(basketItems)
            .where(and(eq(basketItems.tenantId, ctx.tenantId), inArray(basketItems.productId, shorts.map((s) => s.id))))
        ).map((r) => r.productId)
      );
      const todo = shorts.filter((s) => !already.has(s.id));
      if (todo.length === 0) return { ok: true, added: 0, noVisitor: 0, alreadyIn: already.size };
      const [avail, listAt] = await Promise.all([
        availableFor(tx, ctx.tenantId, todo.map((t) => t.id)),
        loadListAges(tx, ctx.tenantId),
      ]);
      const now = Date.now();
      let noVisitor = 0;
      const values = todo.map((p) => {
        const alts = avail
          .filter((a) => a.productId === p.id)
          .map((a) => ({ ...a, ageDays: listAgeInfo(listAt.get(a.visitorId) ?? null, now).ageDays }))
          .sort(compareAlternatives);
        const best = alts[0];
        if (!best) noVisitor++;
        return {
          tenantId: ctx.tenantId,
          productId: p.id,
          productName: p.name,
          visitorId: best ? best.visitorId : null,
          qty: 1,
          price: best ? best.price : null,
        };
      });
      for (let i = 0; i < values.length; i += 100) {
        await tx.insert(basketItems).values(values.slice(i, i + 100)).onConflictDoNothing();
      }
      return { ok: true, added: values.length, noVisitor, alreadyIn: already.size };
    })
  );
}

export async function setBasketQtyAction(input: { id: string; qty: number }): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  const qty = cleanQty(input.qty);
  if (qty === null) return { ok: false, error: `تعداد باید عددی بین ۱ و ${QTY_MAX} باشد` };
  return guard(() =>
    withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const r = await tx
        .update(basketItems)
        .set({ qty })
        .where(and(eq(basketItems.id, input.id), eq(basketItems.tenantId, ctx.tenantId)))
        .returning({ id: basketItems.id });
      if (!r[0]) throw new AppError("ردیف یافت نشد", 404);
      return { ok: true, id: r[0].id };
    })
  );
}

/** تغییر ویزیتور فقط بین ویزیتورهایی که همین کالا را موجود دارند؛ قیمت همان ویزیتور جایگزین می‌شود */
export async function setBasketVisitorAction(input: { id: string; visitorId: string }): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  if (!input.visitorId) return { ok: false, error: "ویزیتور انتخاب نشده است" };
  return guard(() =>
    withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const row = (
        await tx
          .select({ productId: basketItems.productId })
          .from(basketItems)
          .where(and(eq(basketItems.id, input.id), eq(basketItems.tenantId, ctx.tenantId)))
          .limit(1)
      )[0];
      if (!row) throw new AppError("ردیف یافت نشد", 404);
      const vp = (
        await tx
          .select({ price: visitorProducts.price })
          .from(visitorProducts)
          .where(
            and(
              eq(visitorProducts.tenantId, ctx.tenantId),
              eq(visitorProducts.productId, row.productId),
              eq(visitorProducts.visitorId, input.visitorId),
              ne(visitorProducts.stock, "out")
            )
          )
          .limit(1)
      )[0];
      if (!vp) throw new AppError("این کالا نزد این ویزیتور موجود نیست", 400);
      await tx
        .update(basketItems)
        .set({ visitorId: input.visitorId, price: vp.price })
        .where(and(eq(basketItems.id, input.id), eq(basketItems.tenantId, ctx.tenantId)));
      return { ok: true, id: input.id };
    })
  );
}

export async function removeBasketItemAction(id: string): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  return guard(() =>
    withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const r = await tx
        .delete(basketItems)
        .where(and(eq(basketItems.id, id), eq(basketItems.tenantId, ctx.tenantId)))
        .returning({ id: basketItems.id });
      if (!r[0]) throw new AppError("ردیف یافت نشد", 404);
      return { ok: true, id };
    })
  );
}

export async function clearBasketAction(): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  return guard(() =>
    withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx.delete(basketItems).where(eq(basketItems.tenantId, ctx.tenantId));
      return { ok: true };
    })
  );
}

/**
 * ثبت گروهِ یک ویزیتور به‌عنوان سفارش (با createOrderAction: شماره‌ی یکتا و کلید تکرار)؛
 * ردیف‌های همان گروه بعد از ثبت از لیست برداشته می‌شود. تکرارِ همان clientKey سفارش جدید نمی‌سازد.
 */
export async function placeBasketOrderAction(input: { visitorId: string; clientKey: string }): Promise<BasketActionResult> {
  const ctx = await requireAuth();
  if (!input.visitorId) return { ok: false, error: "این گروه ویزیتور ندارد؛ اول ویزیتور را انتخاب کنید" };
  if (!CLIENT_KEY_RE.test(input.clientKey ?? "")) return { ok: false, error: "کلید ثبت معتبر نیست" };
  const clientKey = input.clientKey;
  return guard(async () => {
    const prior = await withTenant(ctx, async (tx) =>
      (
        await tx
          .select({ id: orders.id, orderNo: orders.orderNo })
          .from(orders)
          .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.clientKey, clientKey)))
          .limit(1)
      )[0]
    );
    if (prior) return { ok: true, id: prior.id, orderNo: Number(prior.orderNo), duplicate: true };

    const rows = await withTenant(ctx, async (tx) =>
      tx
        .select({ id: basketItems.id, name: basketItems.productName, qty: basketItems.qty, price: basketItems.price })
        .from(basketItems)
        .where(and(eq(basketItems.tenantId, ctx.tenantId), eq(basketItems.visitorId, input.visitorId)))
    );
    if (rows.length === 0) return { ok: false, error: "لیست این ویزیتور خالی است" };

    const res = await createOrderAction({
      clientKey,
      visitorId: input.visitorId,
      items: rows.map((r) => ({ productName: r.name, qty: r.qty, unitPrice: r.price ?? 0, discountPct: 0 })),
    });
    if (!res.ok || !res.id) return { ok: false, error: res.error ?? "ثبت سفارش ناموفق بود" };
    const orderId = res.id;

    const orderNo = await withTenant(ctx, async (tx) => {
      await tx.delete(basketItems).where(and(eq(basketItems.tenantId, ctx.tenantId), inArray(basketItems.id, rows.map((r) => r.id))));
      const o = (await tx.select({ orderNo: orders.orderNo }).from(orders).where(eq(orders.id, orderId)).limit(1))[0];
      return o ? Number(o.orderNo) : undefined;
    });
    return { ok: true, id: orderId, orderNo };
  });
}
