"use server";

import { and, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { cheques, profiles } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import type { ActionResult } from "@/actions/auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ثبت چک کاملاً دستی — بدون هیچ محاسبه خودکار */
export async function addChequeAction(input: {
  visitorName: string;
  visitorCompany?: string;
  amount: number;
  dueDate: string;
  orderId?: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const name = (input.visitorName ?? "").trim();
  const dueDate = (input.dueDate ?? "").trim();
  const amount = Math.round(Number(input.amount) || 0);
  if (name.length < 2) return { ok: false, error: "نام ویزیتور را وارد کنید" };
  if (amount <= 0) return { ok: false, error: "مبلغ چک معتبر نیست" };
  if (!DATE_RE.test(dueDate) || Number.isNaN(new Date(dueDate).getTime()))
    return { ok: false, error: "تاریخ سررسید معتبر نیست" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      // نمایش: نام شرکت (گیرنده‌ی واقعی چک) در ابتدا، نام ویزیتور به‌عنوان راهنمای کوچک بعد از آن
      const displayName = input.visitorCompany?.trim()
        ? `${input.visitorCompany.trim()} — ${name}`
        : name;
      const inserted = await tx
        .insert(cheques)
        .values({
          tenantId: ctx.tenantId,
          visitorName: displayName,
          amount,
          dueDate,
          orderId: input.orderId || null,
        })
        .returning({ id: cheques.id });
      return { ok: true, id: inserted[0].id };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** تسویه چک → انتقال از نمای فعال به تاریخچه */
export async function settleChequeAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(cheques)
        .set({ settled: true, settledAt: new Date() })
        .where(and(eq(cheques.id, id), eq(cheques.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** حذف چک (عمدتاً برای تاریخچه) */
export async function deleteChequeAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .delete(cheques)
        .where(and(eq(cheques.id, id), eq(cheques.tenantId, ctx.tenantId)));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

/** تنظیم روزهای هشدار سررسید (قابل تغییر از صفحه تنظیمات) */
export async function setChequeWarningDaysAction(days: number): Promise<ActionResult> {
  const ctx = await requireAuth();
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 0 || n > 90)
    return { ok: false, error: "عدد روزها باید بین ۰ تا ۹۰ باشد" };
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .update(profiles)
        .set({ chequeWarningDays: n })
        .where(eq(profiles.id, ctx.tenantId));
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
