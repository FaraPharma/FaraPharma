"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  isOfflineLocked,
  hoursSinceLastOnline,
  verifyRealConnection,
} from "@/lib/connectivity";

/**
 * نگهبان سراسری اتصال — مستقل از هر صفحه‌ی خاصی، در layout ریشه mount
 * می‌شود. اگر بیش از ۴۸ ساعت هیچ اتصال موفقی به سرور برقرار نشده باشد،
 * کل اپ را با یک صفحه‌ی قفل واضح می‌پوشاند تا وضعیت واقعی (ازجمله وضعیت
 * اشتراک) دوباره تأیید شود.
 *
 * صفحات ورود/ثبت‌نام از این قفل مستثنا هستند — چون خودِ ورود موفق یعنی
 * یک اتصال زنده برقرار شده، قفل‌کردن این صفحات یک بن‌بست غیرقابل‌حل
 * می‌ساخت (نمی‌شود وصل شد چون قفل است، نمی‌شود قفل را باز کرد چون وصل
 * نیست).
 *
 * توجه: این فقط روی «خواندن از کش» اثر دارد. ثبت واقعی (سفارش، چک) همیشه
 * به اتصال زنده نیاز داشته و از این مکانیزم عبور نمی‌کند. یادداشت‌های
 * سریعِ در صف هم گم نمی‌شوند — به‌محض بازگشت اتصال، خودکار ارسال می‌شوند.
 */
export function ConnectivityGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);

  const exempt =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/privacy");

  const recheck = useCallback(() => {
    setLocked(isOfflineLocked());
  }, []);

  useEffect(() => {
    if (exempt) return;
    recheck();
    // واکنش فوری به هر اتصال موفق در هر جای اپ
    window.addEventListener("pharma:online-verified", recheck);
    // واکنش به رویدادهای مرورگر برای آنلاین/آفلاین شدن
    window.addEventListener("online", recheck);
    // بررسی دوره‌ای، برای وقتی تب مدتی در پس‌زمینه بوده
    const interval = window.setInterval(recheck, 60_000);
    return () => {
      window.removeEventListener("pharma:online-verified", recheck);
      window.removeEventListener("online", recheck);
      window.clearInterval(interval);
    };
  }, [recheck, exempt]);

  async function retry() {
    setChecking(true);
    const ok = await verifyRealConnection();
    setChecking(false);
    if (ok) setLocked(false);
  }

  if (exempt || !locked) return <>{children}</>;

  const hours = hoursSinceLastOnline();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="card w-full max-w-sm p-6 text-center">
        <div
          className="mx-auto mb-4 grid size-14 place-items-center rounded-full"
          style={{ background: "var(--coral-soft)", color: "#C43F1D" }}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l18 18" />
            <path d="M8.5 8.5a11 11 0 0 1 11-2.5" />
            <path d="M2.5 6a15.5 15.5 0 0 1 4-2.7" />
            <path d="M5 12.5a10.5 10.5 0 0 1 3.5-2.3" />
            <path d="M9 16.5a5 5 0 0 1 6-1.2" />
            <circle cx="12" cy="20" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>
          برای ادامه، به اینترنت وصل شو
        </h2>
        <p className="mt-2 text-xs leading-6" style={{ color: "var(--ink-soft)" }}>
          {hours !== null
            ? `بیش از ${hours >= 48 ? "۴۸" : hours} ساعت است اتصال واقعی برقرار نشده.`
            : "مدتی است اتصال واقعی برقرار نشده."}{" "}
          برای اطمینان از وضعیت حساب و به‌روزبودن اطلاعات، لازم است یک‌بار
          وصل شوی. اطلاعاتی که قبلاً دیده‌ای جایی گم نشده و یادداشت‌های
          ثبت‌شده به‌محض اتصال خودکار ارسال می‌شوند.
        </p>
        <button onClick={retry} disabled={checking} className="btn-primary mt-5 w-full">
          {checking ? "در حال بررسی…" : "تلاش دوباره برای اتصال"}
        </button>
      </div>
    </div>
  );
}
