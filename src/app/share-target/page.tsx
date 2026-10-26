"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge, Button, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { readFile, reportStructure } from "@/components/list-import-dialog";
import { importVisitorListAction } from "@/actions/listImport";
import { addVisitorAction } from "@/actions/visitors";
import { listAgeInfo } from "@/lib/product-search";
import { listAgeLabel } from "@/lib/basket";
import { faNum } from "@/lib/format";
import { SHARE_MESSAGES, classifyShareFile, detectVisitor, orderChoices, type Detection, type VisitorCand } from "@/lib/share-detect";
import { currentTenantId, listShared, removeShared, type SharedEntry } from "@/lib/share-store";

interface Summary {
  visitorName: string;
  rows: number;
  newProducts: number;
  updated: number;
  markedOut: number;
  flagged: number;
  totalMismatch: boolean;
  fileKept: boolean;
}

const URL_ERRORS: Record<string, string> = {
  empty: "فایلی دریافت نشد. دوباره از پیام‌رسان «اشتراک‌گذاری ← دستیار خرید» را بزن.",
  fail: "دریافت فایل ناموفق بود. دوباره امتحان کن، یا از «ورود لیست از فایل» در صفحه‌ی ویزیتورها استفاده کن.",
};

/** ورود لیست از «اشتراک‌گذاری»: نام فایل ← تشخیص ویزیتور ← «ثبت». همان مسیر ورودِ صفحه‌ی ویزیتورها. */
export default function ImportSharePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<SharedEntry[]>([]);
  const [urlError, setUrlError] = useState("");
  const [cands, setCands] = useState<VisitorCand[] | null>(null);
  const [det, setDet] = useState<Detection | null>(null);
  const [pick, setPick] = useState<string | null>(null); // شناسه‌ی ویزیتور یا "new"
  const [newName, setNewName] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canKeepOnly, setCanKeepOnly] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const current = entries[0] ?? null;
  const check = useMemo(() => (current ? classifyShareFile(current.name, current.type, current.size) : null), [current]);
  // مشکلِ فایل: از سرویس‌ورکر (نوع/خالی/حجم)، یا بررسی دوباره‌ی همین‌جا؛ فایل بدون محتوا هم «خالی» است
  const problem = current ? current.problem ?? (check && !check.ok ? check.problem : !current.blob ? "empty" : null) : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listShared(currentTenantId()));
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("e");
    if (e && URL_ERRORS[e]) setUrlError(URL_ERRORS[e]);
    void refresh();
  }, [refresh]);

  // ویزیتورها و تشخیص خودکار برای فایلِ جاری
  useEffect(() => {
    setCands(null);
    setDet(null);
    setPick(null);
    setShowAll(false);
    setError("");
    setCanKeepOnly(false);
    if (!current || problem || !check || !check.ok) return;
    let alive = true;
    fetch("/api/import-share/visitors")
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/login?next=%2Fimport-share";
          return;
        }
        const j = (await res.json()) as { visitors?: VisitorCand[] };
        if (!alive) return;
        const list = j.visitors ?? [];
        const d = detectVisitor(check.fileName, list);
        setCands(list);
        setDet(d);
        if (d.status === "sure" && d.best) setPick(d.best.visitor.id);
      })
      .catch(() => {
        if (alive) setError("دریافت فهرست ویزیتورها ناموفق بود. اینترنت را بررسی کن و دوباره باز کن.");
      });
    return () => {
      alive = false;
    };
  }, [current, check, problem]);

  async function dismiss() {
    if (!current) return;
    await removeShared(current.id).catch(() => undefined);
    setSummary(null);
    await refresh();
  }

  async function uploadOriginal(visitorId: string, file: File): Promise<boolean> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/visitors/${visitorId}/catalog`, { method: "POST", body: fd });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function resolveVisitor(): Promise<{ id: string; name: string } | null> {
    if (pick === "new") {
      const name = newName.trim();
      if (name.length < 2) {
        setError("نام ویزیتور جدید را بنویس.");
        return null;
      }
      const res = await addVisitorAction({ name });
      if (!res.ok || !res.id) {
        setError(res.error ?? "ساخت ویزیتور ممکن نشد.");
        return null;
      }
      return { id: res.id, name };
    }
    const v = cands?.find((c) => c.id === pick);
    return v ? { id: v.id, name: v.name } : null;
  }

  async function submit(keepOnly = false) {
    if (!current?.blob || !check || !check.ok) return;
    setError("");
    setBusy(true);
    try {
      const visitor = await resolveVisitor();
      if (!visitor) return;
      const file = new File([current.blob], check.fileName, { type: current.type || undefined });

      if (keepOnly) {
        const kept = await uploadOriginal(visitor.id, file);
        if (!kept) {
          setError("نگه‌داری فایل ممکن نشد.");
          return;
        }
        toast.success("فایل برای این ویزیتور نگه داشته شد");
        await dismiss();
        return;
      }

      let parsed: Awaited<ReturnType<typeof readFile>>;
      try {
        parsed = await readFile(file);
      } catch (e) {
        reportStructure("share-error", null, e instanceof Error ? e.message.slice(0, 120) : "unknown");
        setError("خواندن خودکار این فایل ممکن نشد. می‌توانی فقط خودِ فایل را برای ویزیتور نگه داری.");
        setCanKeepOnly(true);
        return;
      }
      if (parsed.rows.length === 0) {
        reportStructure("share-empty", parsed);
        setError("ردیفی در این فایل پیدا نشد. می‌توانی فقط خودِ فایل را برای ویزیتور نگه داری.");
        setCanKeepOnly(true);
        return;
      }
      if (parsed.confidence < 0.9) reportStructure("share-low-confidence", parsed);

      const out = await importVisitorListAction({
        visitorId: visitor.id,
        rows: parsed.rows.map((r) => ({
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
        reportStructure("share-import-failed", null, (out.error ?? "").slice(0, 120));
        setError(out.error ?? "ثبت لیست ممکن نشد.");
        return;
      }
      const kept = await uploadOriginal(visitor.id, file);
      setSummary({
        visitorName: visitor.name,
        rows: parsed.rows.length,
        newProducts: out.newProducts ?? 0,
        updated: out.updated ?? 0,
        markedOut: out.markedOut ?? 0,
        flagged: parsed.rows.filter((r) => r.flags.length > 0).length,
        totalMismatch:
          parsed.reportedTotal !== undefined && parsed.parsedTotal !== undefined && parsed.reportedTotal !== parsed.parsedTotal,
        fileKept: kept,
      });
      await removeShared(current.id).catch(() => undefined);
      setEntries((prev) => prev.slice(1));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  // ---------- خلاصه‌ی بعد از ثبت ----------
  if (summary) {
    return (
      <div className="space-y-4">
        <PageHeader title="لیست ثبت شد" subtitle={summary.visitorName} />
        <div className="card space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xl font-extrabold text-[color:var(--ink)]">{faNum(summary.newProducts)}</div>
              <div className="text-[11px] text-[color:var(--ink-soft)]">کالای جدید</div>
            </div>
            <div>
              <div className="text-xl font-extrabold text-[color:var(--ink)]">{faNum(summary.updated)}</div>
              <div className="text-[11px] text-[color:var(--ink-soft)]">به‌روز شد</div>
            </div>
            <div>
              <div className="text-xl font-extrabold text-[color:var(--ink)]">{faNum(summary.markedOut)}</div>
              <div className="text-[11px] text-[color:var(--ink-soft)]">ناموجود شد</div>
            </div>
          </div>
          {summary.flagged > 0 && (
            <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[color:var(--warning-ink)]">
              {faNum(summary.flagged)} ردیف مشکوک بود؛ در صفحه‌ی ویزیتور بررسی‌شان کن.
            </p>
          )}
          {summary.totalMismatch && (
            <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[color:var(--warning-ink)]">
              مجموع مبلغ‌ها با «جمع» پایان فایل نمی‌خواند؛ ردیف‌ها را بررسی کن.
            </p>
          )}
          {!summary.fileKept && (
            <p className="text-[11px] leading-5 text-[color:var(--ink-soft)]">لیست ثبت شد ولی نگه‌داری خودِ فایل ممکن نشد.</p>
          )}
        </div>
        <Button className="w-full text-sm" onClick={() => router.push("/products")}>
          رفتن به جستجو
        </Button>
        {entries.length > 0 && (
          <Button variant="secondary" className="w-full text-sm" onClick={() => setSummary(null)}>
            فایل بعدی ({faNum(entries.length)})
          </Button>
        )}
      </div>
    );
  }

  // ---------- فایلی نیست ----------
  if (!current) {
    return (
      <div className="space-y-4">
        <PageHeader title="ورود لیست از اشتراک‌گذاری" />
        {urlError && (
          <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium leading-5 text-[color:var(--warning-ink)]">
            {urlError}
          </p>
        )}
        <EmptyState
          title="فایلی برای ورود نیست"
          desc="فایل لیست را در بله، روبیکا، ایتا، تلگرام، واتساپ یا فایل‌منیجر باز کن و «اشتراک‌گذاری ← دستیار خرید» را بزن. یا در صفحه‌ی ویزیتورها از «ورود لیست از فایل» استفاده کن."
          action={
            <Button className="px-5 text-sm" onClick={() => router.push("/visitors")}>
              رفتن به ویزیتورها
            </Button>
          }
        />
      </div>
    );
  }

  // ---------- فایلِ مشکل‌دار (نوع/خالی/حجم) ----------
  if (problem) {
    return (
      <div className="space-y-4">
        <PageHeader title="ورود لیست از اشتراک‌گذاری" subtitle={current.name} />
        <p className="rounded-2xl bg-[color:var(--danger-soft)] px-4 py-3 text-sm font-medium leading-6 text-[color:var(--danger-ink)]">
          {SHARE_MESSAGES[problem]}
        </p>
        <Button className="w-full text-sm" onClick={() => void dismiss()}>
          {entries.length > 1 ? "بستن و رفتن به فایل بعدی" : "بستن"}
        </Button>
      </div>
    );
  }

  const choices = cands && det ? orderChoices(cands, det) : [];
  const shortlist = det && det.status !== "sure" && !showAll ? det.matches.slice(0, 4).map((m) => m.visitor) : choices;
  const sure = det?.status === "sure" && !showAll;
  const pickedName = pick === "new" ? newName.trim() : cands?.find((c) => c.id === pick)?.name ?? "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="ورود لیست از اشتراک‌گذاری"
        subtitle={entries.length > 1 ? `فایل ۱ از ${faNum(entries.length)}` : undefined}
      />

      <div className="card space-y-1 p-4">
        <div className="text-[11px] text-[color:var(--ink-soft)]">فایل دریافت‌شده</div>
        <div dir="auto" className="break-all text-sm font-bold text-[color:var(--ink)]">
          {current.name}
        </div>
        <div className="text-[11px] text-[color:var(--ink-soft)]">{faNum(Math.max(1, Math.round(current.size / 1024)))} کیلوبایت</div>
      </div>

      {error && (
        <p className="rounded-xl bg-[color:var(--danger-soft)] px-3 py-2 text-xs font-medium leading-5 text-[color:var(--danger-ink)]">
          {error}
        </p>
      )}

      {!cands || !det ? (
        error ? null : <Spinner label="در حال تشخیص ویزیتور…" />
      ) : (
        <>
          {sure && det.best ? (
            <div className="card space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[color:var(--ink-soft)]">ویزیتور تشخیص‌داده‌شده</span>
                <Badge color="green">مطمئن</Badge>
              </div>
              <div className="text-base font-extrabold text-[color:var(--ink)]">{det.best.visitor.name}</div>
              <Button className="w-full text-sm" disabled={busy} onClick={() => void submit(false)}>
                {busy ? "در حال ثبت…" : "تأیید و ثبت"}
              </Button>
              <button
                type="button"
                className="min-h-11 w-full text-xs font-bold text-[color:var(--primary-dark)]"
                onClick={() => setShowAll(true)}
              >
                ویزیتور دیگری است
              </button>
            </div>
          ) : (
            <div className="card space-y-2 p-4">
              <div className="text-xs font-bold text-[color:var(--ink)]">
                {det.status === "none" ? "ویزیتور از نام فایل معلوم نشد؛ انتخاب کن:" : "این فایل برای کدام ویزیتور است؟"}
              </div>
              <ul className="space-y-1.5">
                {shortlist.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setPick(v.id)}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-right transition active:scale-[0.99]"
                      style={{
                        borderColor: pick === v.id ? "var(--primary)" : "var(--line)",
                        background: pick === v.id ? "var(--primary-soft)" : "var(--surface)",
                      }}
                    >
                      <span className="min-w-0 text-xs font-bold text-[color:var(--ink)]">{v.name}</span>
                      <span className="shrink-0 text-[11px] text-[color:var(--ink-soft)]">
                        {v.lastImportAt ? `آخرین ورود: ${listAgeLabel(listAgeInfo(v.lastImportAt).ageDays)}` : "هنوز لیستی وارد نشده"}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setPick("new")}
                    className="flex min-h-11 w-full items-center rounded-xl border border-dashed px-3 py-2 text-right text-xs font-bold text-[color:var(--primary-dark)]"
                    style={{ borderColor: pick === "new" ? "var(--primary)" : "var(--line)" }}
                  >
                    + ویزیتور جدید
                  </button>
                </li>
              </ul>
              {det.status !== "none" && !showAll && choices.length > shortlist.length && (
                <button
                  type="button"
                  className="min-h-11 w-full text-xs font-bold text-[color:var(--primary-dark)]"
                  onClick={() => setShowAll(true)}
                >
                  نمایش همه‌ی ویزیتورها
                </button>
              )}
              {pick === "new" && (
                <input
                  className="field-input"
                  placeholder="نام ویزیتور جدید"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  aria-label="نام ویزیتور جدید"
                />
              )}
              <Button className="w-full text-sm" disabled={busy || !pick || (pick === "new" && newName.trim().length < 2)} onClick={() => void submit(false)}>
                {busy ? "در حال ثبت…" : pickedName ? `ثبت برای «${pickedName}»` : "ثبت"}
              </Button>
            </div>
          )}

          {canKeepOnly && pick && (
            <Button variant="secondary" className="w-full text-sm" disabled={busy} onClick={() => void submit(true)}>
              فقط نگه‌داری فایل
            </Button>
          )}
          <p className="text-[11px] leading-5 text-[color:var(--ink-soft)]">
            لیست قبلی این ویزیتور به‌روز می‌شود (قیمت‌های قبلی در تاریخچه می‌ماند) و کالاهایی که در این فایل نیستند «ناموجود» می‌شوند.
          </p>
          <button type="button" className="min-h-11 w-full text-xs text-[color:var(--ink-soft)]" onClick={() => void dismiss()}>
            رها کردن این فایل
          </button>
        </>
      )}
    </div>
  );
}
