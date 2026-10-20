import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runMigrations } from "@/db/migrations";
import { withTenant } from "@/db";
import { writeAudit } from "@/lib/audit";

/**
 * اجرای مهاجرت‌های دیتابیس — فقط مدیر (برای بقیه 404).
 *  - POST: اجرا
 *  - GET با ?confirm=yes: اجرا از مرورگر گوشی (بدون confirm فقط راهنما برمی‌گرداند)
 * با اتصال ممتاز MIGRATE_DATABASE_URL (اگر نبود DATABASE_URL). فقط مهاجرت‌های
 * اجراشده‌نشده اجرا می‌شوند. نتیجه به‌صورت JSON برمی‌گردد.
 */
export const dynamic = "force-dynamic";

async function guard(): Promise<NextResponse | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

async function run() {
  const report = await runMigrations();
  // سابقه‌ی عملیات مدیر (اگر جدول audit_log هنوز نباشد، مهم نیست)
  try {
    const ctx = await requireAdmin();
    await withTenant(ctx, (tx) =>
      writeAudit(tx, ctx.userId, {
        action: "migrations.run",
        targetType: "database",
        detail: { ok: report.ok, applied: report.applied.map((a) => a.name), failed: report.failed?.name ?? null },
      })
    );
  } catch {
    /* ignore */
  }
  return NextResponse.json(report, { status: report.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  if (request.nextUrl.searchParams.get("confirm") !== "yes") {
    return NextResponse.json(
      { ok: false, error: "تأیید صریح لازم است", usage: "/api/admin/migrate?confirm=yes" },
      { status: 400 }
    );
  }
  return run();
}

export async function POST() {
  const denied = await guard();
  if (denied) return denied;
  return run();
}
