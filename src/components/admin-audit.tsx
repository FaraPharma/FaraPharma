"use client";

import { useEffect, useState } from "react";

interface AuditRow {
  id: string;
  at: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  actorEmail: string | null;
}

const LABELS: Record<string, string> = {
  "subscription.set": "تغییر اشتراک",
  "account.disable": "غیرفعال کردن حساب",
  "account.enable": "فعال کردن حساب",
  "role.change": "تغییر نقش",
  "migrations.run": "اجرای مهاجرت",
};

function summary(r: AuditRow): string {
  const d = r.detail ?? {};
  if (r.action === "subscription.set") return `${String(d.status ?? "")}${d.endDate ? ` تا ${String(d.endDate)}` : ""}`;
  if (r.action === "migrations.run") return d.ok ? "موفق" : "ناموفق";
  return "";
}

/** سابقه‌ی ۵۰ عملیات آخر مدیر (فقط نمایش) */
export function AdminAudit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/audit")
      .then(async (res) => {
        if (!res.ok) throw new Error("x");
        const j = (await res.json()) as { rows: AuditRow[] };
        if (alive) setRows(j.rows);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="card p-3">
      <div className="mb-2 text-sm font-extrabold" style={{ color: "var(--ink)" }}>سابقه‌ی عملیات مدیر</div>
      {err && <div className="text-xs" style={{ color: "var(--ink-soft)" }}>بارگذاری سابقه ممکن نشد</div>}
      {!err && rows === null && <div className="text-xs" style={{ color: "var(--ink-soft)" }}>در حال بارگذاری…</div>}
      {rows && rows.length === 0 && <div className="text-xs" style={{ color: "var(--ink-soft)" }}>هنوز موردی ثبت نشده است</div>}
      {rows && rows.length > 0 && (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {rows.map((r) => (
            <li key={r.id} className="py-2 text-xs" style={{ borderColor: "var(--line)" }}>
              <div className="font-bold" style={{ color: "var(--ink)" }}>
                {LABELS[r.action] ?? r.action}
                {summary(r) ? ` — ${summary(r)}` : ""}
              </div>
              <div style={{ color: "var(--ink-soft)" }}>
                {new Date(r.at).toLocaleString("fa-IR")} · {r.actorEmail ?? "؟"}
                {r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
