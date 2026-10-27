"use client";

import { useState } from "react";
import { faDateShort, toman } from "@/lib/format";
import { listAgeLabel } from "@/lib/basket";
import type { LastBuyInfo, PriceTrend } from "@/lib/purchase-history";

/** نشان ساده‌ی «گران‌تر شد» (قرمز) / «ارزان‌تر شد» (سبز)؛ بدون تغییر قیمت مهم = چیزی نشان نمی‌دهد */
export function TrendBadge({ trend }: { trend: PriceTrend | undefined }) {
  if (!trend) return null;
  const up = trend === "up";
  return (
    <span
      className="rounded-full px-2 text-[10px] font-bold"
      style={
        up
          ? { background: "var(--danger-soft)", color: "var(--danger-ink)" }
          : { background: "var(--success-soft)", color: "var(--success-ink)" }
      }
    >
      {up ? "گران‌تر شد" : "ارزان‌تر شد"}
    </span>
  );
}

/** «قبلاً از X به قیمت Y» با سن خرید؛ بدون سابقه چیزی نشان نمی‌دهد */
export function LastBuyLine({ lastBuy }: { lastBuy: LastBuyInfo | null | undefined }) {
  if (!lastBuy) return null;
  return (
    <span className="block text-[11px] leading-5" style={{ color: "var(--ink-soft)" }}>
      قبلاً از {lastBuy.visitorName} به قیمت {toman(lastBuy.price)} · {listAgeLabel(lastBuy.ageDays)} ({faDateShort(lastBuy.at)})
    </span>
  );
}

const SHORT = 70;

/** آفر و شرایط پرداخت ویزیتور: یک خط کوتاه، با «بیشتر» اگر طولانی است (فقط نمایش) */
export function TermsLine({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const first = text.split("\n")[0];
  const long = text.length > SHORT || text.includes("\n");
  const shown = open ? text : first.length > SHORT ? `${first.slice(0, SHORT)}…` : first;
  return (
    <span className="block text-[11px] leading-5" style={{ color: "var(--ink-soft)" }}>
      <span className="font-bold">شرایط:</span>{" "}
      <span className="whitespace-pre-line">{shown}</span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mr-1 inline-flex min-h-11 items-center px-1 text-[11px] font-bold"
          style={{ color: "var(--primary-dark)" }}
        >
          {open ? "کمتر" : "بیشتر"}
        </button>
      )}
    </span>
  );
}
