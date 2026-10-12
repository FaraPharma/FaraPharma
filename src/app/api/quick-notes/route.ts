import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { quickNotes } from "@/db/schema";

export const dynamic = "force-dynamic";

/** یادداشتهای خام تنانت جاری — جدیدترین اول */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: quickNotes.id,
          body: quickNotes.body,
          createdAt: quickNotes.createdAt,
        })
        .from(quickNotes)
        .where(eq(quickNotes.tenantId, ctx.tenantId))
        .orderBy(desc(quickNotes.createdAt))
        .limit(200);
      return { notes: rows };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
