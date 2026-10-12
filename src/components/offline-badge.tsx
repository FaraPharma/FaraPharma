"use client";

import { faDateTime } from "@/lib/format";

/** بنر کوچک نمایش داده‌ی آفلاین — رنگ کهربایی واضح برای تشخیص سریع */
export function OfflineBadge({
  stale,
  savedAt,
}: {
  stale: boolean;
  savedAt: number | null;
}) {
  if (!stale) return null;
  return (
    <div className="flex items-center gap-2 rounded-2xl px-3 py-2 text-[11px] font-medium" style={{ border: "1px solid #E08A1E4d", background: "var(--amber-soft)", color: "#8A5A0E" }}>
      <span>📴</span>
      <span>
        نمایش داده آفلاین
        {savedAt ? ` — آخرین بروزرسانی: ${faDateTime(new Date(savedAt))}` : ""}
      </span>
    </div>
  );
}
