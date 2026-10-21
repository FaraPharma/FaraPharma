import { NextRequest, NextResponse } from "next/server";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { assertWritable } from "@/db/access";
import { quickNotes } from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * همگامسازی یادداشتهای صفشده در حالت آفلاین.
 * یک یادداشت در هر درخواست (با بدنه + زمان ثبت اصلی) دریافت و ذخیره میشود.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth();
    const j = (await request.json().catch(() => null)) as {
      body?: string;
      createdAt?: number;
      clientKey?: string;
    } | null;
    const clientKey =
      typeof j?.clientKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(j.clientKey) ? j.clientKey : null;
    const body = (j?.body ?? "").trim();
    if (!body) return NextResponse.json({ error: "متن خالی است" }, { status: 400 });

    await withTenant(ctx, async (tx) => {
      await assertWritable(ctx, tx);
      const createdAt = j?.createdAt
        ? new Date(Math.min(Math.max(j.createdAt, 0), Date.now() + 24 * 3600_000))
        : new Date();
      await tx.insert(quickNotes).values({
        tenantId: ctx.tenantId,
        body: body.slice(0, 5000),
        createdAt,
        clientKey,
      }).onConflictDoNothing(); // ارسال مجدد با همان کلید: بدون ثبت تکراری
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/quick-notes/sync", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
