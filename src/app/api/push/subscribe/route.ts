import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { pushSubscriptions } from "@/db/schema";

export const dynamic = "force-dynamic";

/** ثبت/بهروزرسانی اشتراک Web Push کاربر */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth();
    const j = (await request.json().catch(() => null)) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    } | null;
    if (!j?.endpoint || !j.keys?.p256dh || !j.keys?.auth) {
      return NextResponse.json({ error: "اشتراک نامعتبر" }, { status: 400 });
    }

    await withTenant(ctx, async (tx) => {
      const existing = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.tenantId, ctx.tenantId),
            eq(pushSubscriptions.endpoint, j.endpoint!)
          )
        )
        .limit(1);
      if (existing[0]) {
        await tx
          .update(pushSubscriptions)
          .set({ p256dh: j.keys!.p256dh!, auth: j.keys!.auth! })
          .where(eq(pushSubscriptions.id, existing[0].id));
      } else {
        await tx.insert(pushSubscriptions).values({
          tenantId: ctx.tenantId,
          endpoint: j.endpoint!,
          p256dh: j.keys!.p256dh!,
          auth: j.keys!.auth!,
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}

/** حذف اشتراک */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth();
    const j = (await request.json().catch(() => null)) as {
      endpoint?: string;
    } | null;
    if (j?.endpoint) {
      await withTenant(ctx, async (tx) => {
        await tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.tenantId, ctx.tenantId),
              eq(pushSubscriptions.endpoint, j.endpoint!)
            )
          );
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
