"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { faDateShort, faNum } from "@/lib/format";
import type { ConditionHistory } from "@/lib/types";

function Sparkline({ values }: { values: number[] }) {
  const W = 120;
  const H = 28;
  const P = 3;
  if (values.length === 0) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    P + (i * (W - 2 * P)) / Math.max(values.length - 1, 1),
    H - P - ((v - min) / range) * (H - 2 * P),
  ]);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <polyline
        points={pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--primary)" />
      ))}
    </svg>
  );
}

const STOCK_META: Record<string, { color: "green" | "amber" | "red"; label: string }> = {
  in: { color: "green", label: "دارد" },
  low: { color: "amber", label: "کم" },
  out: { color: "red", label: "ندارد" },
};

/** روند تغییرات شرایط یک کالا نزد یک ویزیتور در طول زمان */
export function TrendPanel({
  history,
  current,
}: {
  history: ConditionHistory[];
  current?: { cashDiscountPct: number; checkDays: number } | null;
}) {
  const [open, setOpen] = useState(false);
  if ((!history || history.length === 0) && !current) return null;

  const sorted = [...(history ?? [])].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  // append the live condition so the sparkline shows "now" as the last point
  const cashSeries = sorted.map((h) => h.cashDiscountPct);
  const checkSeries = sorted.map((h) => h.checkDays);
  if (current) {
    cashSeries.push(current.cashDiscountPct);
    checkSeries.push(current.checkDays);
  }

  return (
    <div className="mt-2 border-t border-[color:var(--line)] pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] font-medium text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
      >
        تاریخچه شرایط ({faNum((history?.length ?? 0) + (current ? 1 : 0))} ثبت){" "}
        {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-[color:var(--ink-soft)]">
            <span className="flex items-center gap-1">
              ٪ نقدی: <Sparkline values={cashSeries} />
            </span>
            <span className="flex items-center gap-1">
              روز چک: <Sparkline values={checkSeries} />
            </span>
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto pe-1">
            {current && (
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[color:var(--primary)] bg-[color:var(--primary-soft)] px-2 py-1.5 text-[10px] text-[color:var(--ink-soft)]">
                <span className="font-bold text-[color:var(--primary-dark)]">اکنون</span>
                <Badge color="blue">نقد {faNum(current.cashDiscountPct)}٪</Badge>
                {current.checkDays > 0 && (
                  <Badge color="violet">چک {faNum(current.checkDays)}</Badge>
                )}
              </div>
            )}
            {[...sorted].reverse().map((h) => {
              const sm = STOCK_META[h.stock];
              return (
                <div
                  key={h.id}
                  className="flex flex-wrap items-center gap-1 rounded-lg bg-[color:var(--line)] px-2 py-1.5 text-[10px] text-[color:var(--ink-soft)]"
                >
                  <span className="text-[color:var(--ink-soft)]">{faDateShort(h.recordedAt)}</span>
                  <Badge color="blue">نقد {faNum(h.cashDiscountPct)}٪</Badge>
                  {h.checkDays > 0 && <Badge color="violet">چک {faNum(h.checkDays)}</Badge>}
                  <Badge color={sm?.color ?? "slate"}>{sm?.label ?? h.stock}</Badge>
                  {h.offer && <span className="truncate">{h.offer}</span>}
                  {h.validUntil && (
                    <span className="text-[color:var(--ink-soft)]">تا {faDateShort(h.validUntil)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
