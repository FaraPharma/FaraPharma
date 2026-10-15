"use client";

import { useState } from "react";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import { PageHeader, Badge, Spinner, EmptyState } from "@/components/ui";
import { cn, faDate, faDateTime, faNum, toman } from "@/lib/format";

interface CondEvent {
  id: string;
  visitorName: string;
  productName: string;
  stock: string;
  cashDiscountPct: number;
  checkDays: number;
  offer: string | null;
  validUntil: string | null;
  price: number | null;
  recordedAt: string;
}

interface ChequeEvent {
  id: string;
  visitorName: string;
  amount: number;
  dueDate: string;
  settled: boolean;
  settledAt: string | null;
  createdAt: string;
}

interface HistoryData {
  conditionEvents: CondEvent[];
  chequeEvents: ChequeEvent[];
}

const STOCK_LABEL: Record<string, string> = { in: "دارد", low: "کم", out: "ندارد" };

export default function HistoryPage() {
  const { data, error, loading, stale, savedAt } =
    useOfflineData<HistoryData>("/api/history");
  const [tab, setTab] = useState<"conditions" | "cheques">("conditions");

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="تاریخچه"
        subtitle="تغییرات قیمت/شرایط و وضعیت چک‌ها — ثبت خودکار"
      />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      {/* تب‌ها */}
      <div className="flex gap-1.5">
        <button
          onClick={() => setTab("conditions")}
          className={cn(
            "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition",
            tab === "conditions"
              ? "bg-[color:var(--primary-dark)] text-[color:var(--on-primary)]"
              : "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)]"
          )}
        >
          قیمت و شرایط
        </button>
        <button
          onClick={() => setTab("cheques")}
          className={cn(
            "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition",
            tab === "cheques"
              ? "bg-[color:var(--primary-dark)] text-[color:var(--on-primary)]"
              : "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)]"
          )}
        >
          چک‌ها
        </button>
      </div>

      {tab === "conditions" ? (
        (data?.conditionEvents.length ?? 0) === 0 ? (
          <EmptyState
            title="هنوز تغییری ثبت نشده"
            desc="با ویرایش شرایط یا قیمت هر کالا، اسنپ‌شات قبلی اینجا ثبت می‌شود"
          />
        ) : (
          <div className="space-y-2.5">
            {data?.conditionEvents.map((e) => (
              <div key={e.id} className="card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-[color:var(--ink)]">
                        {e.productName}
                      </span>
                      <span className="text-[11px] text-[color:var(--ink-soft)]">
                        نزد {e.visitorName}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                      {e.price != null && <Badge color="blue">{toman(e.price)}</Badge>}
                      <Badge color="slate">{STOCK_LABEL[e.stock] ?? e.stock}</Badge>
                      {e.cashDiscountPct > 0 && (
                        <Badge color="teal">نقد {faNum(e.cashDiscountPct)}٪</Badge>
                      )}
                      {e.checkDays > 0 && (
                        <Badge color="violet">چک {faNum(e.checkDays)} روز</Badge>
                      )}
                      {e.validUntil && (
                        <Badge color="amber">تا {faDate(e.validUntil)}</Badge>
                      )}
                    </div>
                    {e.offer && (
                      <p className="mt-1 text-[10px] text-[color:var(--ink-soft)]">{e.offer}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-[color:var(--ink-soft)]">
                    {faDateTime(e.recordedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (data?.chequeEvents.length ?? 0) === 0 ? (
        <EmptyState
          title="چکی ثبت نشده"
          desc="ثبت و تسویه‌ی چک‌ها اینجا نمایش داده می‌شود"
        />
      ) : (
        <div className="space-y-2.5">
          {data?.chequeEvents.map((c) => (
            <div key={c.id} className="card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-[color:var(--ink)]">
                      {c.visitorName}
                    </span>
                    <span className="tnum text-[11px] text-[color:var(--primary-dark)]">
                      {toman(c.amount)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge color="slate">سررسید: {faDate(c.dueDate)}</Badge>
                    {c.settled ? (
                      <Badge color="green">
                        تسویه‌شده — {faDateTime(c.settledAt)}
                      </Badge>
                    ) : (
                      <Badge color="blue">ثبت: {faDateTime(c.createdAt)}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
