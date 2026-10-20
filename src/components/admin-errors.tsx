"use client";

import { useEffect, useState } from "react";

interface ErrRow {
  id: string;
  at: string;
  source: string;
  place: string;
  code: string | null;
  message: string;
}

/** جدول ۵۰ خطای آخر (فقط نمایش) */
export function AdminErrors() {
  const [rows, setRows] = useState<ErrRow[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/errors")
      .then(async (res) => {
        if (!res.ok) throw new Error("x");
        const j = (await res.json()) as { rows: ErrRow[] };
        if (alive) setRows(j.rows);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="card p-3">
      <div className="mb-2 text-sm font-extrabold" style={{ color: "var(--ink)" }}>خطاهای اخیر</div>
      {err && <div className="text-xs" style={{ color: "var(--ink-soft)" }}>بارگذاری خطاها ممکن نشد</div>}
      {!err && rows === null && <div className="text-xs" style={{ color: "var(--ink-soft)" }}>در حال بارگذاری…</div>}
      {rows && rows.length === 0 && <div className="text-xs" style={{ color: "var(--ink-soft)" }}>خطایی ثبت نشده است</div>}
      {rows && rows.length > 0 && (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {rows.map((r) => (
            <li key={r.id} className="py-2 text-xs" style={{ borderColor: "var(--line)" }}>
              <div className="font-bold" style={{ color: "var(--ink)", overflowWrap: "anywhere" }} dir="ltr">
                {r.source === "client" ? "مرورگر" : "سرور"} · {r.place}
              </div>
              <div style={{ color: "var(--ink-soft)", overflowWrap: "anywhere" }} dir="ltr">
                {r.code ? `${r.code} · ` : ""}{r.message}
              </div>
              <div style={{ color: "var(--ink-soft)" }}>{new Date(r.at).toLocaleString("fa-IR")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
