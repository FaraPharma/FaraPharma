import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { auditLog, users } from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/** ۵۰ عملیات آخرِ مدیر (فقط مدیر؛ فقط خواندن) */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({
          id: auditLog.id,
          at: auditLog.at,
          action: auditLog.action,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          detail: auditLog.detail,
          actorEmail: users.email,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .orderBy(desc(auditLog.at))
        .limit(50)
    );
    return NextResponse.json({ rows });
  } catch (e) {
    if (e instanceof AppError && e.status < 500) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // خطای واقعی فقط در لاگ سرور؛ به کاربر فقط پیام ساده‌ی فارسی
    logServerError("/api/admin/audit", e);
    return NextResponse.json({ error: "بارگذاری سابقه ممکن نشد" }, { status: 500 });
  }
}
