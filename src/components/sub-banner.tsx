"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { daysLeft, effectiveStatus, faDate, faNum } from "@/lib/format";
import type { ProfileInfo } from "@/lib/types";

export function SubscriptionBanner({
  profile,
  trialDays,
  compact = false,
}: {
  profile: ProfileInfo | null;
  trialDays: number;
  compact?: boolean;
}) {
  if (!profile) return null;
  const status = effectiveStatus(profile);

  if (status === "active") {
    const left = daysLeft(profile.subscriptionEndsAt);
    return (
      <div className="card flex items-center justify-between p-3" style={{ borderColor: "var(--teal-1)", background: "var(--mint-soft)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">✅</span>
          <div>
            <div className="text-sm font-bold" style={{ color: "#0A7C6B" }}>اشتراک فعال</div>
            <div className="text-[11px]" style={{ color: "#0A7C6B" }}>
              {left !== null && left > 0
                ? `تا ${faDate(profile.subscriptionEndsAt)} (${faNum(left)} روز مانده)`
                : "نامحدود"}
            </div>
          </div>
        </div>
        {!compact && (
          <Link href="/settings" className="text-xs font-medium underline" style={{ color: "#0A7C6B" }}>
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
        className="rounded-2xl p-4 text-white shadow"
        style={{ background: "linear-gradient(120deg, var(--teal-1), var(--cobalt-2))" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎁</span>
            <div>
              <div className="text-sm font-bold">دوره آزمایشی رایگان</div>
              <div className="text-[11px] text-white/80">
                {left > 0 ? `${faNum(left)} روز از ${faNum(trialDays)} روز باقی مانده` : "در حال پایان"}
              </div>
            </div>
          </div>
          <Badge color="teal" className="border-white/30 bg-white/15 text-white">
            {faNum(left)} روز
          </Badge>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #F0562F4d", background: "var(--coral-soft)" }}>
      <div className="flex items-start gap-2">
        <span className="text-lg">⛔</span>
        <div className="flex-1">
          <div className="text-sm font-bold" style={{ color: "#C43F1D" }}>اشتراک منقضی شده است</div>
          <p className="mt-1 text-xs leading-5" style={{ color: "#C43F1D" }}>
            مشاهده و خروجی‌گیری از داده‌ها فعال است، اما ثبت و ویرایش غیرفعال شده. برای
            تمدید اشتراک با پشتیبانی تماس بگیرید.
          </p>
        </div>
      </div>
    </div>
  );
}
