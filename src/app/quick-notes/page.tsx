"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import { PageHeader, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { deleteQuickNoteAction } from "@/actions/quickNotes";
import { faDateTime, faNum } from "@/lib/format";
import type { QuickNote } from "@/lib/types";

interface QuickNotesData {
  notes: QuickNote[];
}

export default function QuickNotesPage() {
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<QuickNotesData>("/api/quick-notes");
  const load = reload;
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = q.trim();
    if (!query) return data.notes;
    return data.notes.filter((n) => n.body.includes(query));
  }, [data, q]);

  async function remove(id: string) {
    if (!confirm("این یادداشت حذف شود؟")) return;
    const res = await deleteQuickNoteAction(id);
    if (res.ok) load();
    else toast.error(res.error ?? "خطا");
  }

  /** هدایت به فرم مربوطه با متن یادداشت (از طریق hash — بدون useSearchParams) */
  function convertTo(target: "visitors" | "products" | "orders", id: string) {
    window.location.href = `/${target}#note=${id}`;
  }

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="یادداشت‌های پردازش‌نشده"
        subtitle="یادداشت‌های خام ثبت سریع — هر زمان خواستید به ویزیتور / کالا / سفارش تبدیل کنید"
      />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      <div className="card flex items-center gap-2 p-2">
        <input
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: "var(--ink)" }}
          placeholder="جستجو در متن یادداشت‌ها…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="یادداشتی ثبت نشده"
          desc="با دکمه شناور «یادداشت سریع» هر مطلبی را در چند ثانیه ثبت کنید"
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((n) => (
            <div key={n.id} className="card p-3.5">
              <p className="whitespace-pre-wrap text-xs leading-6" style={{ color: "var(--ink)" }}>
                {n.body}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
                  {faDateTime(n.createdAt)}
                </span>
                <button
                  onClick={() => remove(n.id)}
                  className="text-[10px]"
                  style={{ color: "var(--danger)" }}
                >
                  حذف
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: "var(--line)" }}>
                <Badge color="slate">تبدیل به:</Badge>
                <button
                  onClick={() => convertTo("visitors", n.id)}
                  className="rounded-full border px-2.5 py-1 text-[10px] font-medium transition"
                  style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
                >
                  ویزیتور
                </button>
                <button
                  onClick={() => convertTo("products", n.id)}
                  className="rounded-full border px-2.5 py-1 text-[10px] font-medium transition"
                  style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
                >
                  کالا
                </button>
                <button
                  onClick={() => convertTo("orders", n.id)}
                  className="rounded-full border px-2.5 py-1 text-[10px] font-medium transition"
                  style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
                >
                  سفارش
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="rounded-xl px-3 py-2 text-center text-[11px] leading-5" style={{ background: "var(--line)", color: "var(--ink-soft)" }}>
        {faNum(filtered.length)} یادداشت — تبدیل‌نشدن یادداشت مشکلی ندارد؛ همین‌جا قابل
        جستجو و در دسترس می‌ماند
      </p>
    </div>
  );
}
