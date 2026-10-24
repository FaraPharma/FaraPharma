"use client";

import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { importVisitorListAction } from "@/actions/listImport";
import { parsePdfPages, parseTable, type ParseResult, type PdfItem } from "@/lib/list-import";
import { faNum } from "@/lib/format";

// قیمت فایل‌ها بدون هیچ واحدی (ریال/تومان) نمایش داده می‌شود؛ فقط عدد با جداکننده‌ی هزارگان
const money = (n: number) => faNum(Math.round(n).toLocaleString("en-US"));
import type { Condition } from "@/lib/types";

const ROLE_FA: Record<string, string> = {
  code: "کد کالا",
  name: "نام کالا",
  warehouse: "انبار",
  unit: "واحد",
  qty: "مانده",
  price: "قیمت واحد",
  amount: "مبلغ",
  offer: "آفر",
  discount: "تخفیف",
  checkDays: "روز چک",
  extra: "ستون اضافه (نگه‌داری می‌شود)",
};

/** فقط «ساختار» فایل گزارش می‌شود (عنوان ستون‌ها و شمارش)، هرگز نام کالا یا قیمت */
function reportStructure(tag: string, r: ParseResult | null, err?: string) {
  const msg = r
    ? `[list-import] ${tag} ${r.format} rows=${r.rows.length} susp=${r.suspicious} conf=${r.confidence} pages=${r.pages} cols=${r.columns.map((c) => `${c.label}:${c.role}`).join(",")}`
    : `[list-import] ${tag} ${err ?? ""}`;
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ place: `${location.pathname} [import]`, message: msg.slice(0, 300) }),
    keepalive: true,
  }).catch(() => undefined);
}

async function readFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages: PdfItem[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vh = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const h = it.height || Math.abs(it.transform[3]) || 10;
        items.push({ str: it.str, x: it.transform[4], y: vh - it.transform[5] - h, w: it.width, h });
      }
      pages.push(items);
    }
    return parsePdfPages(pages);
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf);
  // برگه‌ای با بیشترین ردیف
  let best: unknown[][] = [];
  for (const n of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: "" });
    if (rows.length > best.length) best = rows;
  }
  return parseTable(best);
}

export function ListImportDialog({
  visitorId,
  visitorName,
  file,
  existingCount,
  onClose,
  onSaved,
}: {
  visitorId: string;
  visitorName: string;
  file: File;
  existingCount: number;
  onClose: () => void;
  onSaved: (file: File) => void;
}) {
  const [phase, setPhase] = useState<"reading" | "preview" | "saving" | "failed">("reading");
  const [res, setRes] = useState<ParseResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    readFile(file)
      .then((r) => {
        if (!alive) return;
        setRes(r);
        if (r.rows.length === 0) {
          setError("ردیفی در این فایل پیدا نشد.");
          setPhase("failed");
          reportStructure("empty", r);
        } else {
          setPhase("preview");
          if (r.confidence < 0.9) reportStructure("low-confidence", r);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError("خواندن خودکار این فایل ممکن نشد.");
        setPhase("failed");
        reportStructure("error", null, e instanceof Error ? e.message.slice(0, 120) : "unknown");
      });
    return () => {
      alive = false;
    };
  }, [file]);

  async function save() {
    if (!res) return;
    setPhase("saving");
    const out = await importVisitorListAction({
      visitorId,
      rows: res.rows.map((r) => ({
        code: r.code,
        name: r.name,
        warehouse: r.warehouse,
        unit: r.unit,
        qty: r.qty,
        price: r.price,
        amount: r.amount,
        offer: r.offer,
        discountPct: r.discountPct,
        checkDays: r.checkDays,
        extra: r.extra,
      })),
    });
    if (!out.ok) {
      toast.error(out.error ?? "ثبت لیست ممکن نشد");
      setPhase("preview");
      return;
    }
    toast.success(
      `${faNum(out.newProducts ?? 0)} کالای جدید، ${faNum(out.updated ?? 0)} به‌روزرسانی` +
        ((out.markedOut ?? 0) > 0 ? `، ${faNum(out.markedOut ?? 0)} ناموجود شد` : "")
    );
    onSaved(file);
  }

  const flagged = res?.rows.filter((r) => r.flags.length > 0) ?? [];
  const sample = res?.rows.slice(0, 15) ?? [];
  const totalOk =
    res && res.reportedTotal !== undefined && res.parsedTotal !== undefined ? res.reportedTotal === res.parsedTotal : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-4" style={{ background: "var(--bg, #F1F3F8)" }}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold" style={{ color: "var(--ink)" }}>ورود لیست از فایل</h2>
            <p className="text-[11px]" style={{ color: "var(--ink-soft)" }} dir="auto">{visitorName} · {file.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs" style={{ background: "var(--line)" }}>بستن</button>
        </div>

        {phase === "reading" && <p className="py-10 text-center text-xs" style={{ color: "var(--ink-soft)" }}>در حال خواندن فایل…</p>}

        {phase === "failed" && (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{error}</p>
            <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
              فایل همین‌طور در «فایل‌های ویزیتور» نگه داشته می‌شود. ساختار فایل (بدون نام کالا و قیمت) برای بهبود تشخیص گزارش شد.
            </p>
            <button type="button" className="btn-primary w-full py-3 text-sm" onClick={() => onSaved(file)}>فقط نگه‌داری فایل</button>
          </div>
        )}

        {(phase === "preview" || phase === "saving") && res && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 rounded-2xl p-3" style={{ background: "var(--surface, #fff)" }}>
              <div className="text-center"><div className="text-xl font-extrabold">{faNum(res.rows.length)}</div><div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>ردیف خوانده شد</div></div>
              <div className="text-center"><div className="text-xl font-extrabold" style={{ color: flagged.length ? "#8A4B00" : undefined }}>{faNum(flagged.length)}</div><div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>ردیف مشکوک</div></div>
              <div className="text-center"><div className="text-xl font-extrabold">{faNum(Math.round(res.confidence * 100))}٪</div><div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>اطمینان</div></div>
            </div>
            {totalOk !== null && (
              <p className="rounded-xl px-3 py-2 text-[11px]" style={{ background: totalOk ? "#E3F4F1" : "#FFF4E0", color: totalOk ? "#0B6E64" : "#8A4B00" }}>
                {totalOk ? "مجموع مبلغ‌ها دقیقاً با «جمع» پایان فایل برابر است." : "مجموع مبلغ‌ها با «جمع» پایان فایل نمی‌خواند؛ ردیف‌ها را بررسی کنید."}
              </p>
            )}

            <div className="rounded-2xl p-3" style={{ background: "var(--surface, #fff)" }}>
              <div className="mb-2 text-xs font-bold">ستون‌های شناخته‌شده</div>
              <div className="flex flex-wrap gap-1.5">
                {res.columns.map((c, i) => (
                  <span key={i} className="rounded-full px-2.5 py-1 text-[11px]" style={{ background: c.role === "extra" ? "#EEF1F6" : "#E3F4F1", color: c.role === "extra" ? "#5B6675" : "#0B6E64" }}>
                    {c.role === "extra" ? c.label : ROLE_FA[c.role]}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px]" style={{ color: "var(--ink-soft)" }}>هیچ ستونی دور ریخته نمی‌شود؛ ستون‌های ناشناخته با همان عنوان نگه داشته می‌شوند.</p>
            </div>

            {flagged.length > 0 && (
              <div className="rounded-2xl p-3" style={{ background: "#FFF4E0" }}>
                <div className="mb-1 text-xs font-bold" style={{ color: "#8A4B00" }}>ردیف‌های مشکوک (بررسی کنید)</div>
                {flagged.slice(0, 8).map((r, i) => (
                  <div key={i} className="border-t py-1.5 text-[11px]" style={{ borderColor: "#F0DDB8" }}>
                    <div dir="auto" className="font-bold">{r.code ? `${r.code} · ` : ""}{r.name}</div>
                    <div style={{ color: "#8A4B00" }}>{r.flags.join("، ")}</div>
                  </div>
                ))}
                {flagged.length > 8 && <p className="pt-1 text-[11px]" style={{ color: "#8A4B00" }}>و {faNum(flagged.length - 8)} مورد دیگر</p>}
              </div>
            )}

            <div className="rounded-2xl p-3" style={{ background: "var(--surface, #fff)" }}>
              <div className="mb-1 text-xs font-bold">پیش‌نمایش ۱۵ ردیف اول</div>
              {sample.map((r, i) => (
                <div key={i} className="flex items-start justify-between gap-2 border-t py-1.5 text-[11px]" style={{ borderColor: "var(--line)" }}>
                  <span dir="auto" className="min-w-0 flex-1">{r.code ? <b className="me-1">{r.code}</b> : null}{r.name}</span>
                  <span className="shrink-0 text-end" style={{ color: "var(--ink-soft)" }}>
                    {r.qty !== undefined ? `${faNum(r.qty)} ${r.unit ?? ""}` : ""}
                    {r.price !== undefined ? <div>{money(r.price)}</div> : null}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
              {existingCount > 0
                ? "قیمت و موجودی کالاهای مشترک به‌روز می‌شود (نسخه‌ی قبلی در تاریخچه می‌ماند). کالای ورودهای قبلی که در این فایل نیست «ناموجود» می‌شود و پاک نمی‌شود."
                : "همه‌ی ردیف‌ها به لیست محصولات این ویزیتور اضافه می‌شود."}
            </p>
            <button type="button" disabled={phase === "saving"} className="btn-primary w-full py-3 text-sm" onClick={save}>
              {phase === "saving" ? "در حال ثبت…" : `ثبت ${faNum(res.rows.length)} ردیف در لیست محصولات`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** جزئیات کامل یک ردیف ورودی (کد، انبار، واحد، مانده، مبلغ و ستون‌های اضافه) */
export function ConditionDetails({ c }: { c: Condition }) {
  const [open, setOpen] = useState(false);
  const basic = [c.code ? `کد ${c.code}` : "", c.qty != null && c.qty !== "" ? `مانده ${faNum(Number(c.qty))}${c.unit ? " " + c.unit : ""}` : "", c.warehouse ? `انبار ${c.warehouse}` : ""].filter(Boolean);
  const extraEntries = Object.entries(c.extra ?? {});
  if (basic.length === 0 && c.amount == null && extraEntries.length === 0) return null;
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-x-2 text-[11px]" style={{ color: "var(--ink-soft)" }}>
        {basic.map((b, i) => <span key={i}>{b}</span>)}
        <button type="button" onClick={() => setOpen((o) => !o)} className="font-bold" style={{ color: "var(--primary-dark)" }}>
          {open ? "بستن جزئیات" : "جزئیات"}
        </button>
      </div>
      {open && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl p-2 text-[11px]" style={{ background: "var(--line)" }}>
          {c.rawName && (<><dt style={{ color: "var(--ink-soft)" }}>نام در فایل</dt><dd dir="auto">{c.rawName}</dd></>)}
          {c.amount != null && (<><dt style={{ color: "var(--ink-soft)" }}>مبلغ</dt><dd>{money(c.amount)}</dd></>)}
          {extraEntries.map(([k, v]) => (<Fragment key={k}><dt style={{ color: "var(--ink-soft)" }}>{k}</dt><dd dir="auto">{v}</dd></Fragment>))}
        </dl>
      )}
    </div>
  );
}
