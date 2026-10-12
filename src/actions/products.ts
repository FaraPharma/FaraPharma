"use server";

import { eq, and, inArray } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { products, baseProducts } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { CATEGORIES } from "@/lib/config";
import type { ActionResult } from "@/actions/auth";

export interface BulkResult extends ActionResult {
  added?: number;
  skipped?: number;
  invalid?: number;
}

export async function addProductAction(input: {
  name: string;
  code?: string;
  category: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const name = (input.name ?? "").trim();
  if (name.length < 2) return { ok: false, error: "نام کالا را وارد کنید" };
  if (!(input.category in CATEGORIES))
    return { ok: false, error: "دسته‌بندی معتبر نیست" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const dup = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.name, name)))
        .limit(1);
      if (dup.length > 0)
        return { ok: false, error: "کالایی با این نام قبلاً ثبت شده است" };
      const inserted = await tx
        .insert(products)
        .values({
          tenantId: ctx.tenantId,
          name,
          code: input.code?.trim() || null,
          category: input.category,
        })
        .returning({ id: products.id });
      return { ok: true, id: inserted[0].id };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateProductAction(input: {
  id: string;
  name: string;
  code?: string;
  category: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const name = (input.name ?? "").trim();
  if (name.length < 2) return { ok: false, error: "نام کالا را وارد کنید" };
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(products)
        .set({
          name,
          code: input.code?.trim() || null,
          category: input.category,
        })
        .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Copies a base-catalog product into the tenant's own catalog. */
export async function addProductFromBaseAction(
  baseProductId: string
): Promise<ActionResult> {
  const ctx = await requireAuth();
  if (!baseProductId)
    return { ok: false, error: "کالای کاتالوگ انتخاب نشده است" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const rows = await tx
        .select({ name: baseProducts.name, category: baseProducts.category })
        .from(baseProducts)
        .where(eq(baseProducts.id, baseProductId))
        .limit(1);
      if (!rows[0]) return { ok: false, error: "کالای کاتالوگ یافت نشد" };
      const dup = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.name, rows[0].name)))
        .limit(1);
      if (dup.length > 0)
        return { ok: false, error: `«${rows[0].name}» قبلاً در لیست شما هست` };
      const inserted = await tx
        .insert(products)
        .values({
          tenantId: ctx.tenantId,
          name: rows[0].name,
          code: null,
          category: rows[0].category,
        })
        .returning({ id: products.id });
      return { ok: true, id: inserted[0].id };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Bulk import (e.g. from Excel): rows with duplicate names — either within
 * the file or against the tenant's existing catalog — are skipped without
 * failing the rest of the file.
 */
export async function bulkAddProductsAction(input: {
  items: Array<{ name: string; code?: string; category?: string }>;
}): Promise<BulkResult> {
  const ctx = await requireAuth();
  const raw = input.items ?? [];

  // normalize + dedupe within the file itself (first occurrence wins)
  const seen = new Set<string>();
  const normalized: Array<{ name: string; code: string | null; category: string }> = [];
  let invalid = 0;
  for (const it of raw) {
    const name = (it.name ?? "").trim();
    if (name.length < 2) {
      invalid++;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const cat =
      it.category && it.category in CATEGORIES ? it.category : "cosmetic";
    normalized.push({ name, code: it.code?.trim() || null, category: cat });
  }
  if (normalized.length === 0) {
    return {
      ok: false,
      error:
        invalid > 0
          ? "هیچ ردیف معتبری در فایل پیدا نشد (نام کالا الزامی است)"
          : "فایل خالی است",
      invalid,
    };
  }

  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const names = normalized.map((n) => n.name);
      const existing = await tx
        .select({ name: products.name })
        .from(products)
        .where(
          and(eq(products.tenantId, ctx.tenantId), inArray(products.name, names))
        );
      const existingSet = new Set(existing.map((e) => e.name));
      const toInsert = normalized.filter((n) => !existingSet.has(n.name));
      if (toInsert.length > 0) {
        await tx.insert(products).values(
          toInsert.map((n) => ({
            tenantId: ctx.tenantId,
            name: n.name,
            code: n.code,
            category: n.category,
          }))
        );
      }
      return {
        ok: true,
        added: toInsert.length,
        skipped: normalized.length - toInsert.length,
        invalid,
      };
    });
  } catch (e) {
    if (e instanceof AppError)
      return { ok: false, error: e.message, invalid };
    throw e;
  }
}

/** Soft delete: keeps price-request history intact. */
export async function deleteProductAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(products)
        .set({ active: false })
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
