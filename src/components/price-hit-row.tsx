"use client";

import { LastBuyLine, TermsLine, TrendBadge } from "@/components/purchase-hints";
import type { LastBuyInfo, PriceTrend } from "@/lib/purchase-history";
import { faNum, toman } from "@/lib/format";

/** یک نتیجه‌ی جستجوی یکپارچه‌ی قیمت: کالا × ویزیتور */
export interface PriceHit {
  conditionId: string;
  productName: string;
  visitorId: string;
  visitorName: string;
  price: number | null;
  qty: number | null;
  unit: string | null;
  stock: string;
  ageDays: number | null;
  stale: boolean;
  cheapest: boolean;
  lastBuy: LastBuyInfo | null;
  trend: PriceTrend;
}

function ageLabel(days: number | null): string {
  if (days === null) return "بدون تاریخ";
  if (days <= 0) return "امروز";
  if (days === 1) return "دیروز";
  return `${faNum(days)} روز پیش`;
}

function stockLabel(p: { qty: number | null; unit: string | null; stock: string }): string {
  if (p.qty !== null && p.qty > 0) return `موجودی ${faNum(p.qty)}${p.unit ? ` ${p.unit}` : ""}`;
  return p.stock === "low" ? "موجودی کم" : "موجود";
}

/**
 * ردیف نتیجه‌ی جستجوی قیمت (پنجره‌ی جستجوی سراسری و صفحه‌ی اصلی یک ظاهر دارند).
 * onOpen خالی = بدنه‌ی ردیف فقط نمایش است (دکمه نیست).
 */
export function PriceHitRow({
  p,
  terms,
  added,
  onAdd,
  onOpen,
}: {
  p: PriceHit;
  terms?: string;
  added: boolean;
  onAdd: () => void;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium" style={{ color: "var(--ink)" }}>
          {p.productName}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]" style={{ color: "var(--ink-soft)" }}>
          <span>{p.visitorName}</span>
          <span>{stockLabel(p)}</span>
          <span
            className={p.stale ? "rounded-md px-1.5 font-bold" : undefined}
            style={p.stale ? { background: "var(--warning-soft)", color: "var(--warning-ink)" } : undefined}
          >
            لیست: {ageLabel(p.ageDays)}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {p.price != null && (
          <span className="tnum text-[11px] font-bold" style={{ color: "var(--primary-dark)" }}>
            {toman(p.price)}
          </span>
        )}
        <TrendBadge trend={p.trend} />
        {p.cheapest && (
          <span
            className="rounded-full px-2 text-[10px] font-bold"
            style={{ background: "var(--success-soft)", color: "var(--success-ink)" }}
          >
            ارزان‌ترین
          </span>
        )}
      </span>
    </>
  );
  const bodyClass = "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-right";
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {onOpen ? (
          <button onClick={onOpen} className={`${bodyClass} transition hover:bg-[color:var(--line)]`}>
            {body}
          </button>
        ) : (
          <div className={bodyClass}>{body}</div>
        )}
        <button
          type="button"
          onClick={onAdd}
          disabled={added}
          aria-label={`افزودن ${p.productName} به لیست خرید`}
          className="btn-secondary shrink-0 !px-3 text-[11px] font-bold"
        >
          {added ? "افزوده شد" : "افزودن"}
        </button>
      </div>
      {(p.lastBuy || terms) && (
        <div className="space-y-0.5 px-2.5 pb-1.5">
          <LastBuyLine lastBuy={p.lastBuy} />
          <TermsLine text={terms} />
        </div>
      )}
    </div>
  );
}
