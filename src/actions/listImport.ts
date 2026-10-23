"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { products, visitorProductHistory, visitorProducts, visitors } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { recordError } from "@/lib/error-log";
import type { ActionResult } from "@/actions/auth";

export interface ImportRowInput {
  code?: string;
  name: string;
  warehouse?: string;
  unit?: string;
  qty?: number;
  price?: number;
  amount?: number;
  offer?: string;
  discountPct?: number;
  checkDays?: number;
  extra?: Record<string, string>;
}

export interface ListImportResult extends ActionResult {
  newProducts?: number;
  created?: number;
  updated?: number;
  markedOut?: number;
  invalid?: number;
  history?: number;
}

const MAX_ROWS = 3000;
const NAME_BATCH = 120; // هر دستور حدود ≤۱۶KB (محدودیت اتصال Workers)
const ROW_BATCH = 20;

const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const rng = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

interface CleanRow {
  name: string;
  code: string | null;
  warehouse: string | null;
  unit: string | null;
  qty: number | null;
  price: number | null;
  amount: number | null;
  offer: string | null;
  discountPct: number;
  checkDays: number;
  extra: Record<string, string> | null;
}

/**
 * ثبت لیست خوانده‌شده‌ی ویزیتور (از پیش‌نمایش تأییدشده):
 *  - کالای تازه ساخته می‌شود، کالای موجود (هم‌نام) به‌روز می‌شود؛ ردیف تکراری ساخته نمی‌شود.
 *  - قیمت/موجودی قبلیِ تغییرکرده در تاریخچه‌ی ویزیتور می‌ماند (برای روند و مقایسه).
 *  - کالای ورودهای قبلی که در این لیست نیست «ناموجود» می‌شود، پاک نمی‌شود. کالای دستی دست نمی‌خورد.
 *  - همه‌ی ستون‌ها نگه داشته می‌شود؛ ستون‌های ناشناخته در extra.
 */
export async function importVisitorListAction(input: {
  visitorId: string;
  fileId?: string;
  rows: ImportRowInput[];
}): Promise<ListImportResult> {
  const ctx = await requireAuth();
  if (!input?.visitorId) return { ok: false, error: "ویزیتور انتخاب نشده است" };
  if (!Array.isArray(input.rows) || input.rows.length === 0) return { ok: false, error: "ردیفی برای ثبت نیست" };
  if (input.rows.length > MAX_ROWS) return { ok: false, error: `حداکثر ${MAX_ROWS} ردیف در هر بار قابل ثبت است` };

  const seen = new Set<string>();
  const rows: CleanRow[] = [];
  let invalid = 0;
  for (const r of input.rows) {
    const name = txt(r?.name, 200);
    if (name.length < 2) {
      invalid++;
      continue;
    }
    // هویت کالا = نام؛ دو ردیف هم‌نام در یک فایل یک کالاست (و در یک دستور upsert نباید دوبار بیاید)
    if (seen.has(name)) continue;
    seen.add(name);
    let extra: Record<string, string> | null = null;
    if (r.extra && typeof r.extra === "object") {
      const e: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.extra).slice(0, 20)) {
        const kk = txt(k, 60);
        const vv = txt(v, 300);
        if (kk && vv) e[kk] = vv;
      }
      if (Object.keys(e).length) extra = e;
    }
    const price = rng(r.price, 0, 2_147_483_647);
    rows.push({
      name,
      code: txt(r.code, 60) || null,
      warehouse: txt(r.warehouse, 60) || null,
      unit: txt(r.unit, 30) || null,
      qty: rng(r.qty, -1e9, 1e9) ?? null,
      price: price === undefined ? null : Math.round(price),
      amount: (() => {
        const a = rng(r.amount, -9e15, 9e15);
        return a === undefined ? null : Math.round(a);
      })(),
      offer: txt(r.offer, 300) || null,
      discountPct: Math.round(rng(r.discountPct, 0, 100) ?? 0),
      checkDays: Math.round(rng(r.checkDays, 0, 3650) ?? 0),
      extra,
    });
  }
  if (rows.length === 0) return { ok: false, error: "ردیف معتبری پیدا نشد", invalid };

  const fileId = input.fileId && /^[0-9a-f-]{36}$/i.test(input.fileId) ? input.fileId : null;

  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const v = await tx
        .select({ id: visitors.id })
        .from(visitors)
        .where(and(eq(visitors.id, input.visitorId), eq(visitors.tenantId, ctx.tenantId)))
        .limit(1);
      if (!v[0]) throw new AppError("ویزیتور پیدا نشد", 404);

      const importId = crypto.randomUUID();

      // ۱) کالاها: موجودها را پیدا و تازه‌ها را بساز
      const idByName = new Map<string, string>();
      const names = rows.map((r) => r.name);
      for (let i = 0; i < names.length; i += NAME_BATCH) {
        const found = await tx
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.name, names.slice(i, i + NAME_BATCH))));
        for (const f of found) idByName.set(f.name, f.id);
      }
      const codeByName = new Map(rows.map((r) => [r.name, r.code] as const));
      const missing = names.filter((n) => !idByName.has(n));
      let newProducts = 0;
      for (let i = 0; i < missing.length; i += ROW_BATCH) {
        const ins = await tx
          .insert(products)
          .values(missing.slice(i, i + ROW_BATCH).map((n) => ({ tenantId: ctx.tenantId, name: n, category: "cosmetic", code: codeByName.get(n) ?? null })))
          .returning({ id: products.id, name: products.name });
        for (const f of ins) idByName.set(f.name, f.id);
        newProducts += ins.length;
      }

      // ۲) وضعیت قبلیِ همین ویزیتور (برای تاریخچه‌ی تغییرها و شمارش به‌روزرسانی/ساخت)
      const prevRows = await tx
        .select({
          productId: visitorProducts.productId,
          stock: visitorProducts.stock,
          price: visitorProducts.price,
          cashDiscountPct: visitorProducts.cashDiscountPct,
          checkDays: visitorProducts.checkDays,
          offer: visitorProducts.offer,
          validUntil: visitorProducts.validUntil,
          code: visitorProducts.code,
          warehouse: visitorProducts.warehouse,
          unit: visitorProducts.unit,
          qty: visitorProducts.qty,
          amount: visitorProducts.amount,
          extra: visitorProducts.extra,
        })
        .from(visitorProducts)
        .where(and(eq(visitorProducts.tenantId, ctx.tenantId), eq(visitorProducts.visitorId, input.visitorId)));
      const prev = new Map(prevRows.map((p) => [p.productId, p]));

      const newStock = (r: CleanRow) => (r.qty === null ? null : r.qty > 0 ? "in" : "out");
      const hist: Array<typeof visitorProductHistory.$inferInsert> = [];
      let created = 0;
      let updated = 0;
      for (const r of rows) {
        const pid = idByName.get(r.name);
        if (!pid) continue;
        const p = prev.get(pid);
        if (!p) {
          created++;
          continue;
        }
        updated++;
        const ns = newStock(r);
        const changed =
          (r.price !== null && r.price !== p.price) ||
          (ns !== null && ns !== p.stock) ||
          (r.discountPct > 0 && r.discountPct !== p.cashDiscountPct) ||
          (r.offer !== null && r.offer !== p.offer);
        if (changed) {
          hist.push({
            tenantId: ctx.tenantId,
            visitorId: input.visitorId,
            productId: pid,
            stock: p.stock,
            cashDiscountPct: p.cashDiscountPct,
            checkDays: p.checkDays,
            offer: p.offer,
            validUntil: p.validUntil,
            price: p.price,
            recordedAt: new Date(),
          });
        }
      }
      for (let i = 0; i < hist.length; i += ROW_BATCH) await tx.insert(visitorProductHistory).values(hist.slice(i, i + ROW_BATCH));

      // ۳) ثبت/به‌روزرسانی. مقدار نهایی هر ردیف (تازه روی قبلی؛ خالی، مقدار قبلی را پاک نمی‌کند) همین‌جا ساخته
      //    می‌شود و SQL فقط همان را می‌نویسد؛ پس به CASE/COALESCE درون ON CONFLICT وابسته نیستیم.
      for (let i = 0; i < rows.length; i += ROW_BATCH) {
        const batch = rows.slice(i, i + ROW_BATCH).flatMap((r) => {
          const pid = idByName.get(r.name);
          if (!pid) return [];
          const p = prev.get(pid);
          const qtyFinal = r.qty !== null ? String(r.qty) : p?.qty ?? null;
          const mergedExtra = r.extra || p?.extra ? { ...(p?.extra ?? {}), ...(r.extra ?? {}) } : null;
          return [
            {
              tenantId: ctx.tenantId,
              visitorId: input.visitorId,
              productId: pid,
              stock: newStock(r) ?? p?.stock ?? "in",
              cashDiscountPct: r.discountPct > 0 ? r.discountPct : p?.cashDiscountPct ?? 0,
              checkDays: r.checkDays > 0 ? r.checkDays : p?.checkDays ?? 0,
              price: r.price ?? p?.price ?? null,
              offer: r.offer ?? p?.offer ?? null,
              code: r.code ?? p?.code ?? null,
              warehouse: r.warehouse ?? p?.warehouse ?? null,
              unit: r.unit ?? p?.unit ?? null,
              qty: qtyFinal,
              amount: r.amount ?? p?.amount ?? null,
              rawName: r.name,
              extra: mergedExtra,
              sourceFileId: fileId,
              lastImportId: importId,
            },
          ];
        });
        if (batch.length === 0) continue;
        await tx
          .insert(visitorProducts)
          .values(batch)
          .onConflictDoUpdate({
            target: [visitorProducts.tenantId, visitorProducts.visitorId, visitorProducts.productId],
            set: {
              price: sql`excluded.price`,
              stock: sql`excluded.stock`,
              cashDiscountPct: sql`excluded.cash_discount_pct`,
              checkDays: sql`excluded.check_days`,
              offer: sql`excluded.offer`,
              code: sql`excluded.code`,
              warehouse: sql`excluded.warehouse`,
              unit: sql`excluded.unit`,
              qty: sql`excluded.qty`,
              amount: sql`excluded.amount`,
              rawName: sql`excluded.raw_name`,
              extra: sql`excluded.extra`,
              sourceFileId: sql`excluded.source_file_id`,
              lastImportId: sql`excluded.last_import_id`,
              updatedAt: new Date(),
            },
          });
      }

      // ۴) کالای ورودهای قبلی که در این لیست نیست: «ناموجود» (پاک نمی‌شود؛ کالای دستی دست نمی‌خورد)
      const out = await tx
        .update(visitorProducts)
        .set({ stock: "out", updatedAt: new Date() })
        .where(
          and(
            eq(visitorProducts.tenantId, ctx.tenantId),
            eq(visitorProducts.visitorId, input.visitorId),
            sql`${visitorProducts.lastImportId} IS NOT NULL`,
            sql`${visitorProducts.lastImportId} <> ${importId}`,
            sql`${visitorProducts.stock} <> 'out'`
          )
        )
        .returning({ id: visitorProducts.id });

      return { ok: true, newProducts, created, updated, markedOut: out.length, invalid, history: hist.length };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    await recordError("importVisitorListAction", e, { tenantId: ctx.tenantId, userId: ctx.userId });
    return { ok: false, error: "ثبت لیست ممکن نشد؛ دوباره تلاش کنید" };
  }
}
