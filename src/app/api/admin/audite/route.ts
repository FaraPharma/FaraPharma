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
const status = e instanceof AppError ? e.status : 500;
if (status >= 500) logServerError("/api/admin/audit", e);
return NextResponse.json({ error: e instanceof Error ? e.message : "خطای سرور" }, { status });
}
}
