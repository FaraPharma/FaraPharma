"use client";

import { useEffect, useState } from "react";
import { toJalaali, toGregorian, jalaaliMonthLength } from "jalaali-js";

/**
 * انتخابگر تاریخ شمسی (جلالی) — جایگزین input type=date میلادی.
 * مقدار خروجی همیشه ISO میلادی (yyyy-mm-dd) است تا با ستون date دیتابیس
 * و بقیه‌ی کد (فیلترها، هشدارها، مقایسه) سازگار بماند.
 */

const MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const p2 = (n: number) => String(n).padStart(2, "0");

function toIso(y: number, m: number, d: number): string {
  // تبدیل شمسی → میلادی باید با toGregorian انجام شود
  const g = toGregorian(y, m, d);
  return `${g.gy}-${p2(g.gm)}-${p2(g.gd)}`;
}

function fromIso(iso: string): { jy: number; jm: number; jd: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const now = new Date();
    return toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  const [gy, gm, gd] = iso.split("-").map(Number);
  return toJalaali(gy, gm, gd);
}

function toFa(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function JalaliDatePicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => fromIso(value));

  useEffect(() => {
    if (value) setView(fromIso(value));
  }, [value]);

  const dayCount = jalaaliMonthLength(view.jy, view.jm);

  // محاسبه افست شروع هفته: شنبه = 0
  const dow = (() => {
    const d = new Date(toIso(view.jy, view.jm, 1));
    return (d.getDay() + 1) % 7;
  })();

  const cells: Array<number | null> = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let d = 1; d <= dayCount; d++) cells.push(d);

  const current = fromIso(value);

  function pick(d: number) {
    onChange(toIso(view.jy, view.jm, d));
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          "field-input flex items-center justify-between gap-2 text-right " +
          (className ?? "")
        }
      >
        <span>
          {value
            ? `${toFa(view.jy)}/${toFa(view.jm)}/${toFa(view.jd)}`
            : "انتخاب تاریخ"}
        </span>
        <span className="text-[color:var(--ink-soft)]">📅</span>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-2xl border border-[color:var(--line)] bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setView((v) => ({
                  jy: v.jm === 1 ? v.jy - 1 : v.jy,
                  jm: v.jm === 1 ? 12 : v.jm - 1,
                  jd: 1,
                }))
              }
              className="grid size-7 place-items-center rounded-lg bg-[color:var(--line)] text-xs"
            >
              ‹
            </button>
            <span className="text-xs font-bold text-[color:var(--ink)]">
              {MONTHS_FA[view.jm - 1]} {toFa(view.jy)}
            </span>
            <button
              type="button"
              onClick={() =>
                setView((v) => ({
                  jy: v.jm === 12 ? v.jy + 1 : v.jy,
                  jm: v.jm === 12 ? 1 : v.jm + 1,
                  jd: 1,
                }))
              }
              className="grid size-7 place-items-center rounded-lg bg-[color:var(--line)] text-xs"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-[color:var(--ink-soft)]">
            {["ش", "ی", "د", "س", "چ", "پ", "ج"].map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) =>
              d === null ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(d)}
                  className={
                    "rounded-lg py-1 text-xs transition " +
                    (d === current.jd &&
                    view.jm === current.jm &&
                    view.jy === current.jy
                      ? "bg-[color:var(--teal-1)] font-bold text-white"
                      : "text-[color:var(--ink)] hover:bg-[color:var(--mint-soft)]")
                  }
                >
                  {toFa(d)}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
