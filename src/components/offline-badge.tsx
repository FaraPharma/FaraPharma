"use client";

import { faDateTime } from "@/lib/format";

/** بنر کوچک نمایش داده‌ی آفلاین — کهربایی برای تشخیص سریع */
export function OfflineBadge({
  stale,
  savedAt,
}: {
  stale: boolean;
  savedAt: number | null;
}) {
  if (!stale) return null;
  return (
    <div
      className="rounded-2xl px-4 py-2.5 text-[11px] font-medium leading-5"
      style={{ background: "var(--warning-soft)", color: "var(--warning-ink)" }}
    >
      نمایش داده آفلاین
      {savedAt ? ` — آخرین بروزرسانی: ${faDateTime(new Date(savedAt))}` : ""}
    </div>
  );
}
