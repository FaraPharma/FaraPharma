import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { errorLog } from "@/db/schema";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/** ۵۰ خطای آخر (فقط مدیر؛ فقط خواندن) */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({ id: errorLog.id, at: errorLog.at, source: errorLog.source, place: errorLog.place, code: errorLog.code, message: errorLog.message })
        .from(errorLog)
        .orderBy(desc(errorLog.at))
        .limit(50)
    );
    return NextResponse.json({ rows });
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return NextResponse.json({ error: e.message }, { status: e.status });
    logServerError("/api/admin/errors", e);
    return NextResponse.json({ error: "بارگذاری خطاها ممکن نشد" }, { status: 500 });
  }
}
