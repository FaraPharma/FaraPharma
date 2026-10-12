import { sql } from "drizzle-orm";
import { db } from "@/db";
import { sendPush } from "@/lib/push";

/**
 * هسته‌ی محرک یادآوری چک‌ها — مستقل از پلتفرم (قابل فراخوانی از
 * Netlify Scheduled Function یا هر cron دیگر):
 * ۱) همه‌ی تنانت‌ها را میچرخد
 * ۲) چکهای تسویهنشده با فاصله ≤ cheque_warning_days هر تنانت را مییابد
 * ۳) برای هر چک واجدشرایط، به تمام اشتراکهای push همان تنانت اعلان میفرستد
 * ۴) با last_notified_at فقط یکبار در روز برای هر چک اعلان میفرستد
 */

export async function sendDueChequeNotifications(): Promise<{
  checkedTenants: number;
  notifiedCheques: number;
  failed: number;
}> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // چکهای واجدشرایط سراسری (اتصال به profiles برای آستانه هر تنانت):
  // - تسویهنشده
  // - فاصله تا سررسید ≤ cheque_warning_days همان تنانت (با tolerance تا ۱ روز آینده)
  // - امروز هنوز اعلان نگرفته
  const due = await db.execute(sql`
    SELECT
      c.id,
      c.tenant_id,
      c.visitor_name,
      c.amount,
      c.due_date,
      p.cheque_warning_days
    FROM cheques c
    JOIN profiles p ON p.id = c.tenant_id
    WHERE c.settled = false
      AND c.due_date <= (CURRENT_DATE + LEAST(p.cheque_warning_days, 90))
      AND (
        c.last_notified_at IS NULL
        OR c.last_notified_at::date < CURRENT_DATE
      )
  `);

  const rows = due.rows as Array<{
    id: string;
    tenant_id: string;
    visitor_name: string;
    amount: number;
    due_date: string;
    cheque_warning_days: number;
  }>;

  // اشتراکهای push همه‌ی تنانتهای درگیر (join با چکهای واجدشرایط —
  // بدون آرایه پارامتری که ممکن است در برخی درایورها محدودیت داشته باشد)
  let subs: Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
    tenant_id: string;
  }> = [];
  if (rows.length > 0) {
    const q = await db.execute(sql`
      SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth, ps.tenant_id
      FROM push_subscriptions ps
      JOIN cheques c ON c.tenant_id = ps.tenant_id
      JOIN profiles p ON p.id = ps.tenant_id
      WHERE c.settled = false
        AND c.due_date <= (CURRENT_DATE + LEAST(p.cheque_warning_days, 90))
        AND (c.last_notified_at IS NULL OR c.last_notified_at::date < CURRENT_DATE)
    `);
    subs = q.rows as typeof subs;
  }

  let notified = 0;
  let failed = 0;
  for (const c of rows) {
    const tenantSubs = subs.filter((s) => s.tenant_id === c.tenant_id);
    if (tenantSubs.length === 0) {
      // اشتراکی نیست؛ ولی برای جلوگیری از ارزیابی مجدد امروز، علامت میزنیم
      await db.execute(sql`UPDATE cheques SET last_notified_at = now() WHERE id = ${c.id}`);
      continue;
    }
    const d = new Date(`${c.due_date}T00:00:00`);
    const diff = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
    const body =
      diff < 0
        ? `${c.visitor_name} — ${c.amount.toLocaleString("fa-IR")} تومان، ${-diff} روز از سررسید گذشته`
        : `${c.visitor_name} — ${c.amount.toLocaleString("fa-IR")} تومان، ${diff} روز تا سررسید`;

    let ok = false;
    for (const s of tenantSubs) {
      const sent = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        {
          title: "💳 چک نزدیک سررسید",
          body,
          tag: `cheque-${c.id}`,
          url: "/cheques",
        }
      );
      if (sent) ok = true;
    }
    if (ok) {
      notified++;
    } else {
      failed++;
    }
    // جلوگیری از تکرار روزانه — صرفنظر از موفقیت ارسال، برای امروز ثبت میشود
    await db.execute(sql`UPDATE cheques SET last_notified_at = now() WHERE id = ${c.id}`);
  }

  const tenantCount = new Set(rows.map((r) => r.tenant_id)).size;
  return { checkedTenants: tenantCount, notifiedCheques: notified, failed };
}
