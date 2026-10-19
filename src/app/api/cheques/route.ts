import { NextResponse } from "next/server";
import { and, eq, asc, desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAuth } from "@/lib/auth";
import { cheques, profiles } from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/** چکهای فعال (بر اساس سررسید) + تاریخچه تسویهشده + روزهای هشدار */
export async function GET() {
  try {
    const ctx = await requireAuth();
    const data = await withTenant(ctx, async (tx) => {
      const [prof] = await tx
        .select({
          id: profiles.id,
          name: profiles.name,
          phone: profiles.phone,
          status: profiles.status,
          trialEndsAt: profiles.trialEndsAt,
          subscriptionEndsAt: profiles.subscriptionEndsAt,
          createdAt: profiles.createdAt,
          warningDays: profiles.chequeWarningDays,
        })
        .from(profiles)
        .where(eq(profiles.id, ctx.tenantId))
        .limit(1);
      const [active, history] = await Promise.all([
        tx
          .select()
          .from(cheques)
          .where(
            and(eq(cheques.tenantId, ctx.tenantId), eq(cheques.settled, false))
          )
          .orderBy(asc(cheques.dueDate), desc(cheques.createdAt))
          .limit(300),
        tx
          .select()
          .from(cheques)
          .where(
            and(eq(cheques.tenantId, ctx.tenantId), eq(cheques.settled, true))
          )
          .orderBy(desc(cheques.settledAt))
          .limit(200),
      ]);
      return {
        cheques: active,
        history,
        warningDays: prof?.warningDays ?? 7,
        role: ctx.role,
        profile: prof
          ? {
              id: prof.id,
              name: prof.name,
              phone: prof.phone,
              status: prof.status,
              trialEndsAt: prof.trialEndsAt,
              subscriptionEndsAt: prof.subscriptionEndsAt,
              createdAt: prof.createdAt,
            }
          : null,
      };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/cheques", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
