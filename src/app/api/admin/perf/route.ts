
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sql } from "drizzle-orm";
import { AppError, withTenant } from "@/db";
import { pool } from "@/db/pool";
import { requireAdmin } from "@/lib/auth";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * اندازه‌گیری سرعت واقعی سرور↔دیتابیس (فقط مدیر، فقط خواندن، بدون نوشتن).
 * authMs: احراز هویت (شامل ساخت اتصال تازه و اولین رفت‌وبرگشت)
 * rttMs: پنج SELECT 1 روی همان اتصال (تأخیر هر رفت‌وبرگشت)
 * txMs: یک تراکنش مثل درخواست‌های برنامه (BEGIN + set_config + SELECT + COMMIT)
 */
export async function GET() {
  try {
    const a0 = Date.now();
    const ctx = await requireAdmin();
    const authMs = Date.now() - a0;

    const rttMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      await pool.query("SELECT 1");
      rttMs.push(Date.now() - t);
    }
    const t1 = Date.now();
    await withTenant(ctx, (tx) => tx.execute(sql`SELECT 1`));
    const txMs = Date.now() - t1;

    let cf: { colo?: string; country?: string } | undefined;
    try {
      cf = (getCloudflareContext() as unknown as { cf?: { colo?: string; country?: string } }).cf;
    } catch {
      cf = undefined;
    }
    return NextResponse.json({
      colo: cf?.colo ?? null,
      country: cf?.country ?? null,
      authMs,
      rttMs,
      rttAvgMs: Math.round(rttMs.reduce((s, x) => s + x, 0) / rttMs.length),
      txMs,
    });
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return NextResponse.json({ error: e.message }, { status: e.status });
    logServerError("/api/admin/perf", e);
    return NextResponse.json({ error: "اندازه‌گیری ممکن نشد" }, { status: 500 });
  }
}
