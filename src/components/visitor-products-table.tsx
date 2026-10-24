"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { faNum } from "@/lib/format";
import { normalizeFa } from "@/lib/list-import";
import type { Condition } from "@/lib/types";

type SortKey = "code" | "name" | "priceAsc" | "priceDesc" | "qty";
type GroupKey = "none" | "code" | "warehouse";

const STOCK_LABEL: Record<string, string> = { in: "دارد", low: "کم", out: "ناموجود" };
const GRID = "28px 52px minmax(0,1fr) 50px 84px"; // ردیف | کد | نام | مانده | قیمت (راست‌به‌چپ)

const num = (n: number | null | undefined) => (n == null ? "—" : faNum(Math.round(n).toLocaleString("en-US")));
const codeOf = (c: Condition) => (c.code ?? c.productCode ?? "").toString();

/** مرتب‌سازی عددیِ طبیعی برای کد (۲۹۲۳۷ < ۳۰۴۱۵)، سپس متن */
function cmpCode(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (a && b && Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "fa");
}

/** برچسب گروه: کلمه‌ای که در ≥۶۰٪ نام‌های گروه آمده (مثلاً نام برند) */
function groupLabel(items: Condition[]): string {
  if (items.length < 3) return "";
  const df = new Map<string, number>();
  for (const c of items) {
    const toks = new Set(
      normalizeFa(c.productName ?? "")
        .split(/[\s\-–_/()]+/)
        .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
    );
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [t, n] of df) {
    if (n / items.length >= 0.6 && (n > bestN || (n === bestN && t.length > best.length))) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

/**
 * لیست کالاهای یک ویزیتور به‌شکل جدول منظم (مثل اکسل): ردیف، کد، نام کامل، مانده، قیمت؛
 * مرتب‌سازی و گروه‌بندی؛ لمس هر ردیف جزئیات، تاریخچه و ویرایش را باز می‌کند.
 */
export function VisitorProductsTable({ conds, renderDetail }: { conds: Condition[]; renderDetail: (c: Condition) => ReactNode }) {
  const hasCodes = useMemo(() => conds.filter((c) => codeOf(c).length >= 4).length > conds.length / 2, [conds]);
  const [sort, setSort] = useState<SortKey>(hasCodes ? "code" : "name");
  const [group, setGroup] = useState<GroupKey>(hasCodes && conds.length >= 40 ? "code" : "none");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const a = [...conds];
    const name = (c: Condition) => normalizeFa(c.productName ?? "");
    if (sort === "code") a.sort((x, y) => cmpCode(codeOf(x), codeOf(y)) || name(x).localeCompare(name(y), "fa"));
    else if (sort === "name") a.sort((x, y) => name(x).localeCompare(name(y), "fa"));
    else if (sort === "priceAsc") a.sort((x, y) => (x.price ?? Infinity) - (y.price ?? Infinity));
    else if (sort === "priceDesc") a.sort((x, y) => (y.price ?? -1) - (x.price ?? -1));
    else a.sort((x, y) => Number(y.qty ?? -1) - Number(x.qty ?? -1));
    return a;
  }, [conds, sort]);

  const limit = showAll ? sorted.length : 120;
  const shown = sorted.slice(0, limit);

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "all", title: "", items: shown }];
    const m = new Map<string, Condition[]>();
    for (const c of shown) {
      const k = group === "code" ? (codeOf(c).length >= 4 ? codeOf(c).slice(0, 3) : "—") : c.warehouse || "—";
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return [...m.entries()].map(([k, items]) => {
      const label = group === "code" ? groupLabel(items) : "";
      const title = group === "code" ? `${k === "—" ? "بدون کد" : `سری ${faNum(k)}`}${label ? ` · ${label}` : ""}` : `انبار ${faNum(k)}`;
      return { key: k, title, items };
    });
  }, [shown, group]);

  let rowNo = 0;
  const sel = "rounded-lg border px-2 py-1 text-[11px]";
  const selStyle = { borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" } as const;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--ink-soft)" }}>
        <label className="flex items-center gap-1">
          ترتیب
          <select className={sel} style={selStyle} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="code">کد کالا</option>
            <option value="name">نام کالا</option>
            <option value="priceAsc">قیمت (کم به زیاد)</option>
            <option value="priceDesc">قیمت (زیاد به کم)</option>
            <option value="qty">بیشترین مانده</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          گروه‌بندی
          <select className={sel} style={selStyle} value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            <option value="none">بدون گروه</option>
            <option value="code">بر اساس سری کد</option>
            <option value="warehouse">بر اساس انبار</option>
          </select>
        </label>
        <span className="ms-auto">{faNum(conds.length)} کالا</span>
      </div>

      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--line)", background: "var(--surface)", fontVariantNumeric: "tabular-nums" }}>
        <div className="grid items-center gap-x-2 px-2 py-2 text-[11px] font-bold" style={{ gridTemplateColumns: GRID, background: "var(--line)", color: "var(--ink)" }}>
          <span className="text-center">ردیف</span>
          <span>کد</span>
          <span>نام کالا</span>
          <span className="text-center">مانده</span>
          <span className="text-end">قیمت</span>
        </div>

        {groups.map((g) => (
          <Fragment key={g.key}>
            {g.title && (
              <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-extrabold" style={{ background: "#E3F4F1", color: "#0B6E64" }}>
                <span dir="auto">{g.title}</span>
                <span className="font-normal">{faNum(g.items.length)} کالا</span>
              </div>
            )}
            {g.items.map((c, i) => {
              rowNo++;
              const isOpen = open === c.id;
              const out = c.stock === "out";
              return (
                <div key={c.id} style={{ background: i % 2 ? "rgba(0,0,0,0.025)" : "transparent", borderTop: "1px solid var(--line)" }}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : c.id)}
                    className="grid w-full items-start gap-x-2 px-2 py-2 text-start"
                    style={{ gridTemplateColumns: GRID, minHeight: 40 }}
                    aria-expanded={isOpen}
                  >
                    <span className="text-center text-[11px]" style={{ color: "var(--ink-soft)" }}>{faNum(rowNo)}</span>
                    <span className="text-[11px]" style={{ color: "var(--ink-soft)" }} dir="ltr">{faNum(codeOf(c)) || "—"}</span>
                    <span className="text-[12px] font-bold leading-6 break-words" style={{ color: "var(--ink)", opacity: out ? 0.6 : 1 }} dir="auto">
                      {faNum(c.productName)}
                    </span>
                    <span className="text-center text-[11px] font-bold" style={{ color: out ? "#B42318" : "var(--ink)" }}>
                      {out ? "ناموجود" : c.qty != null && c.qty !== "" ? faNum(Number(c.qty)) : STOCK_LABEL[c.stock] ?? c.stock}
                    </span>
                    <span className="text-end text-[12px] font-bold">{num(c.price)}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 pt-1" style={{ background: "var(--surface)" }}>
                      {renderDetail(c)}
                    </div>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      {!showAll && sorted.length > limit && (
        <button type="button" onClick={() => setShowAll(true)} className="btn-secondary mt-2 w-full py-2 text-xs">
          نمایش همه‌ی {faNum(sorted.length)} کالا
        </button>
      )}
    </div>
  );
}
