import { NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { profiles, users, visitors, products, orders } from "@/db/schema";
import { TRIAL_DAYS } from "@/lib/config";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * فهرست کامل داروخانه‌ها برای پنل مدیریت — شامل وضعیت اشتراک و
 * شاخص‌های سبک استفاده (تعداد ویزیتور/محصول/سفارش) تا ادمین علاوه‌بر
 * وضعیت اشتراک، میزان فعالیت واقعی هر داروخانه را هم ببیند.
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    const data = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: profiles.id,
          name: profiles.name,
          phone: profiles.phone,
          status: profiles.status,
          trialEndsAt: profiles.trialEndsAt,
          subscriptionEndsAt: profiles.subscriptionEndsAt,
          createdAt: profiles.createdAt,
          userId: users.id,
          email: users.email,
          disabled: users.disabled,
          visitorCount: sql<number>`(SELECT count(*) FROM ${visitors} WHERE ${visitors.tenantId} = ${profiles.id})`,
          productCount: sql<number>`(SELECT count(*) FROM ${products} WHERE ${products.tenantId} = ${profiles.id})`,
          orderCount: sql<number>`(SELECT count(*) FROM ${orders} WHERE ${orders.tenantId} = ${profiles.id} AND ${orders.deletedAt} IS NULL)`,
        })
        .from(profiles)
        .leftJoin(users, eq(profiles.ownerUserId, users.id))
        .orderBy(desc(profiles.createdAt));
      return { profiles: rows, trialDays: TRIAL_DAYS };
    });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status >= 500) logServerError("/api/admin/profiles", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای سرور" },
      { status }
    );
  }
}
