"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { daysLeft, effectiveStatus, faDate, faNum } from "@/lib/format";
import type { ProfileInfo } from "@/lib/types";

export function SubscriptionBanner({
  profile,
  trialDays,
  compact = false,
  role,
}: {
  profile: ProfileInfo | null;
  trialDays: number;
  compact?: boolean;
  role?: string;
}) {
  if (!profile) return null;

  // مدیر هیچ‌وقت «آزمایشی» یا «منقضی» نمی‌بیند
  if (role === "admin") {
    return (
      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: "var(--success-soft)", color: "var(--success-ink)" }}
      >
        <div className="text-sm font-bold">حساب مدیر</div>
        <div className="text-[11px]">بدون محدودیت اشتراک</div>
      </div>
    );
  }

  const status = effectiveStatus(profile, role);

  if (status === "active") {
    const left = daysLeft(profile.subscriptionEndsAt);
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
        style={{ background: "var(--success-soft)", color: "var(--success-ink)" }}
      >
        <div>
          <div className="text-sm font-bold">اشتراک فعال</div>
          <div className="text-[11px]">
            {left !== null && left > 0 && left < 3650
              ? `تا ${faDate(profile.subscriptionEndsAt)} (${faNum(left)} روز مانده)`
              : "نامحدود"}
          </div>
        </div>
        {!compact && (
          <Link href="/settings" className="flex min-h-11 items-center text-xs font-bold underline">
            جزئیات
          </Link>
        )}
      </div>
    );
  }

  if (status === "trial") {
    const left = daysLeft(profile.trialEndsAt) ?? trialDays;
    const pct = Math.max(0, Math.min(100, Math.round((left / trialDays) * 100)));
    return (
      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: "var(--warning-soft)", color: "var(--warning-ink)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">دوره آزمایشی رایگان</div>
            <div className="text-[11px]">
              {left > 0
                ? `${faNum(left)} روز از ${faNum(trialDays)} روز باقی مانده`
                : "در حال پایان"}
            </div>
          </div>
          <Badge color="amber">{faNum(left)} روز</Badge>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full"
          style={{ background: "var(--surface)" }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: "var(--warning)" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl px-4 py-3"
      style={{ background: "var(--danger-soft)", color: "var(--danger-ink)" }}
    >
      <div className="text-sm font-bold">اشتراک منقضی شده است</div>
      <p className="mt-1 text-xs leading-5">
        مشاهده و خروجی‌گیری از داده‌ها فعال است، اما ثبت و ویرایش غیرفعال شده. برای تمدید اشتراک
        با پشتیبانی تماس بگیرید.
      </p>
    </div>
  );
}
