"use server";

import { and, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { assertWritable } from "@/db/access";
import { quickNotes } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import type { ActionResult } from "@/actions/auth";

/** ثبت یادداشت خام سریع — فقط یک متن آزاد، بدون هیچ فیلد اجباری */
export async function addQuickNoteAction(input: {
  body: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "متن یادداشت خالی است" };
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const inserted = await tx
        .insert(quickNotes)
        .values({ tenantId: ctx.tenantId, body: body.slice(0, 5000) })
        .returning({ id: quickNotes.id });
      return { ok: true, id: inserted[0].id };
    });
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteQuickNoteAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      await tx
        .delete(quickNotes)
        .where(
          and(eq(quickNotes.id, id), eq(quickNotes.tenantId, ctx.tenantId))
        );
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
