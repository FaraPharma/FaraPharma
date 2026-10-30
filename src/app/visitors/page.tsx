"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import { SubscriptionBanner } from "@/components/sub-banner";
import { TRIAL_DAYS } from "@/lib/config";
import { TrendPanel } from "@/components/trend";
import {
  PageHeader,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Textarea,
  Spinner,
  EmptyState,
  AddButton,
} from "@/components/ui";
import { ConditionForm } from "@/components/condition-form";
import { MicButton } from "@/components/mic-button";
import {
  addVisitorAction,
  updateVisitorAction,
  deleteVisitorAction,
  addVisitorNoteAction,
  deleteVisitorNoteAction,
  deleteConditionAction,
} from "@/actions/visitors";
import { bulkAddVisitorProductsAction } from "@/actions/visitorProducts";
import { ListImportDialog, ConditionDetails } from "@/components/list-import-dialog";
import { VisitorTermsField } from "@/components/visitor-terms-field";
import { normalizeFa } from "@/lib/list-import";
import { whatsappUrl, telegramUrl, baleUrl, rubikaUrl } from "@/lib/domain";
import { cn, faDate, faDateTime, faNum, toman, toNum } from "@/lib/format";
import type {
  Visitor,
  VisitorNote,
  Product,
  Condition,
  ConditionHistory,
  CatalogFile,
} from "@/lib/types";

interface VisitorsData {
  visitors: Visitor[];
  notes: VisitorNote[];
  conditions: Condition[];
  products: Product[];
  history: ConditionHistory[];
  catalogs: CatalogFile[];
  profile: {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
    createdAt: string;
  } | null;
  role?: string;
}

const STOCK_BADGE: Record<string, { color: "green" | "amber" | "red"; label: string }> = {
  in: { color: "green", label: "دارد" },
  low: { color: "amber", label: "کم" },
  out: { color: "red", label: "ندارد" },
};

export default function VisitorsPage() {
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<VisitorsData>("/api/visitors");
  const load = reload;
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Visitor | null>(null);
  const selectedId = selected?.id ?? null;
  const [editVisitor, setEditVisitor] = useState<Visitor | null>(null);
  const [condOpen, setCondOpen] = useState<{ visitorId: string; initial: Condition | null } | null>(null);
  // بخش جمع‌شده‌ی «پیشرفته» (فرم قدیمی شرایط هر محصول)؛ مسیر اصلیِ شرایط، کادر «شرایط تسویه و آفر» است
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    setAdvancedOpen(false);
  }, [selectedId]);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: "",
    company: "",
    phone: "",
    messengerUsername: "",
    mainProducts: "",
  });

  // ---------- افزودن سریع محصول (تایپ تکی / پیست چندخطی) ----------
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [addMode, setAddMode] = useState<"type" | "paste">("type");
  const [pasteText, setPasteText] = useState("");

  // هنگام بارگذاری مجدد داده‌ها، شیء انتخابی را تازه نگه می‌دارد
  useEffect(() => {
    setSelected((sel) =>
      sel && data ? data.visitors.find((v) => v.id === sel.id) ?? sel : sel
    );
  }, [data]);

  // تبدیل یادداشت سریع به ویزیتور (از صفحه یادداشتها با #note=)
  const [qnText, setQnText] = useState("");
  useEffect(() => {
    const m = window.location.hash.match(/note=([0-9a-f-]{36})/);
    if (!m) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    fetch("/api/quick-notes")
      .then((r) => r.json())
      .then((j) => {
        const note = (j.notes ?? []).find((x: { id: string }) => x.id === m[1]);
        if (note) {
          setQnText(note.body);
          setForm({
            name: "",
            company: "",
            phone: "",
            messengerUsername: "",
            mainProducts: note.body.slice(0, 200),
          });
          setAddOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = q.trim();
    if (!query) return data.visitors;
    return data.visitors.filter(
      (v) =>
        v.name.includes(query) ||
        (v.company ?? "").includes(query) ||
        (v.phone ?? "").includes(query)
    );
  }, [data, q]);

  function openAdd() {
    setForm({ name: "", company: "", phone: "", messengerUsername: "", mainProducts: "" });
    setAddOpen(true);
  }

  async function saveVisitor(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await addVisitorAction({
      name: form.name,
      company: form.company,
      phone: form.phone,
      messengerUsername: form.messengerUsername,
      mainProducts: form.mainProducts,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("ویزیتور اضافه شد");
      setAddOpen(false);
      load();
    } else toast.error(res.error ?? "خطا در ذخیره");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editVisitor) return;
    setBusy(true);
    const res = await updateVisitorAction({
      id: editVisitor.id,
      name: form.name,
      company: form.company,
      phone: form.phone,
      messengerUsername: form.messengerUsername,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("ویرایش شد");
      setEditVisitor(null);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function removeVisitor(v: Visitor) {
    if (!confirm(`ویزیتور «${v.name}» و همه داده‌هایش (و کالاهایی که فقط او داشته) حذف شود؟`)) return;
    const res = await deleteVisitorAction(v.id);
    if (res.ok) {
      toast.success(res.removedProducts ? `حذف شد؛ ${faNum(res.removedProducts)} کالای بدون ویزیتور هم پاک شد` : "حذف شد");
      setSelected(null);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const res = await addVisitorNoteAction({ visitorId: selected.id, body: noteText });
    if (res.ok) {
      setNoteText("");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function removeNote(id: string) {
    const res = await deleteVisitorNoteAction(id);
    if (res.ok) load();
    else toast.error(res.error ?? "خطا");
  }

  async function removeCondition(id: string) {
    if (!confirm("این شرط حذف شود؟")) return;
    const res = await deleteConditionAction(id);
    if (res.ok) load();
    else toast.error(res.error ?? "خطا");
  }

  const selectedNotes = selected ? data?.notes.filter((n) => n.visitorId === selected.id) ?? [] : [];
  const selectedConds = selected ? data?.conditions.filter((c) => c.visitorId === selected.id) ?? [] : [];
  const [importFile, setImportFile] = useState<File | null>(null);
  const [condQuery, setCondQuery] = useState("");
  const [condShowAll, setCondShowAll] = useState(false);
  const visibleConds = useMemo(() => {
    const q = normalizeFa(condQuery).toLowerCase();
    if (!q) return selectedConds;
    return selectedConds.filter((c) =>
      normalizeFa(
        [c.productName, c.code, c.productCode, c.offer, c.warehouse, c.rawName, ...Object.values(c.extra ?? {})].filter(Boolean).join(" ")
      )
        .toLowerCase()
        .includes(q)
    );
  }, [selectedConds, condQuery]);

  /**
   * ورود گروهی کالاهای این ویزیتور از اکسل:
   * ستونها: نام کالا | قیمت | درصد نقدی | روزهای چک | آفر
   */
  async function handleVisitorExcel(file: File) {
    if (!selected) return;
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        toast.error("برگه‌ای در فایل پیدا نشد");
        return;
      }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
      });
      const items: Array<{
        name: string;
        price?: number;
        cashDiscountPct?: number;
        checkDays?: number;
        offer?: string;
      }> = [];
      rows.forEach((row, i) => {
        const name = String(row[0] ?? "").trim();
        if (i === 0 && /نام/i.test(name)) return; // ردیف عنوان
        if (!name) return;
        items.push({
          name,
          price: Number(String(row[1]).replace(/[^\d]/g, "")) || undefined,
          cashDiscountPct: Number(String(row[2]).replace(/[^\d]/g, "")) || 0,
          checkDays: Number(String(row[3]).replace(/[^\d]/g, "")) || 0,
          offer: String(row[4] ?? "").trim() || undefined,
        });
      });
      if (items.length === 0) {
        toast.error("ردیف معتبری پیدا نشد (ستون اول باید نام کالا باشد)");
        return;
      }
      const res = await bulkAddVisitorProductsAction({
        visitorId: selected.id,
        items,
      });
      if (res.ok) {
        const skipped =
          (res.skipped ?? 0) > 0 ? ` — ${faNum(res.skipped ?? 0)} تکراری رد شد` : "";
        toast.success(`${faNum(res.added ?? 0)} کالای جدید + شرایط ثبت شد${skipped}`);
        load();
      } else toast.error(res.error ?? "خطا در ورود فایل");
    } catch {
      toast.error("خواندن فایل ناموفق بود — فرمت xlsx/xls/csv باشد");
    }
  }

  /** پیشنهاد هوشمند: از محصولاتی که همین ویزیتور یا هر ویزیتور دیگری قبلاً ثبت کرده */
  const quickSuggestions = useMemo(() => {
    if (!data || quickName.trim().length < 1) return [];
    const query = quickName.trim();
    const ownProductIds = new Set(
      selectedConds.map((c) => c.productId)
    );
    return data.products
      .filter((p) => p.name.includes(query))
      .slice(0, 5)
      .map((p) => {
        const usedByCount = data.conditions.filter(
          (c) => c.productId === p.id
        ).length;
        return {
          id: p.id,
          name: p.name,
          own: ownProductIds.has(p.id),
          otherCount: usedByCount,
        };
      });
  }, [data, quickName, selectedConds]);

  /**
   * هشدار قیمت غیرعادی — فقط اطلاع‌رسانی، هیچ‌وقت مانع ثبت نمی‌شود.
   * عدد خام را نشان می‌دهد، نه یک قضاوت قطعی؛ فقط وقتی تفاوت واقعاً بزرگ
   * است (۱۵٪+) نشان داده می‌شود تا هشدار کمیاب و معنی‌دار بماند.
   */
  const priceWarning = useMemo(() => {
    if (!data || !quickPrice || quickName.trim().length < 2) return null;
    const newPrice = toNum(quickPrice);
    if (!newPrice) return null;
    const match = data.products.find((p) => p.name === quickName.trim());
    if (!match) return null;

    const ownPrev = selectedConds.find((c) => c.productId === match.id)?.price;
    if (ownPrev && ownPrev > 0) {
      const diffPct = Math.round(((newPrice - ownPrev) / ownPrev) * 100);
      if (Math.abs(diffPct) >= 15) {
        return {
          kind: diffPct > 0 ? "up" : "down",
          text:
            diffPct > 0
              ? `${faNum(diffPct)}٪ بیشتر از قیمت قبلی همین ویزیتور (${faNum(ownPrev)})`
              : `${faNum(Math.abs(diffPct))}٪ کمتر از قیمت قبلی همین ویزیتور (${faNum(ownPrev)})`,
        };
      }
    }

    const others = data.conditions.filter(
      (c) => c.productId === match.id && c.visitorId !== selected?.id && c.price
    );
    if (others.length > 0) {
      const cheapest = others.reduce((min, c) => (c.price! < min.price! ? c : min), others[0]);
      if (cheapest.price && newPrice > cheapest.price) {
        const diffPct = Math.round(((newPrice - cheapest.price) / cheapest.price) * 100);
        if (diffPct >= 15) {
          return {
            kind: "up" as const,
            text: `${cheapest.visitorName} همین را ${faNum(diffPct)}٪ ارزان‌تر (${faNum(cheapest.price)}) دارد`,
          };
        }
      }
    }
    return null;
  }, [data, quickName, quickPrice, selectedConds, selected]);

  /** افزودن آنی یک محصول با تایپ — به‌محض Enter، مستقیم به کاتالوگ همین ویزیتور اضافه می‌شود */
  async function handleQuickAdd() {
    if (!selected || !quickName.trim()) return;
    setQuickBusy(true);
    const res = await bulkAddVisitorProductsAction({
      visitorId: selected.id,
      items: [
        {
          name: quickName.trim(),
          price: quickPrice ? toNum(quickPrice) : undefined,
        },
      ],
    });
    setQuickBusy(false);
    if (res.ok) {
      setQuickName("");
      setQuickPrice("");
      load();
    } else toast.error(res.error ?? "خطا در ثبت");
  }

  /** پیست متن خام (مثلاً از واتساپ) — هر خط: نام [فاصله] قیمت */
  const parsedPasteItems = useMemo(() => {
    return pasteText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.*?)([\d۰-۹][\d۰-۹,،]*)\s*$/);
        if (m && m[1].trim()) {
          return { name: m[1].trim(), price: toNum(m[2]) || undefined };
        }
        return { name: line, price: undefined };
      });
  }, [pasteText]);

  async function handlePasteAdd() {
    if (!selected || parsedPasteItems.length === 0) return;
    setQuickBusy(true);
    const res = await bulkAddVisitorProductsAction({
      visitorId: selected.id,
      items: parsedPasteItems,
    });
    setQuickBusy(false);
    if (res.ok) {
      const skipped =
        (res.skipped ?? 0) > 0 ? ` — ${faNum(res.skipped ?? 0)} تکراری رد شد` : "";
      toast.success(`${faNum(res.added ?? parsedPasteItems.length)} مورد ثبت شد${skipped}`);
      setPasteText("");
      load();
    } else toast.error(res.error ?? "خطا در ثبت");
  }

  /** توضیح آنچه هنگام آپلود اکسل اتفاق می‌افتد: افزودن/آپدیت، نه پاک‌کردن کامل */
  async function handleVisitorExcelConfirmed(file: File) {
    if (
      selectedConds.length > 0 &&
      !confirm(
        `این ویزیتور الان ${faNum(selectedConds.length)} کالای ثبت‌شده دارد.\nموارد مشترک با قیمت جدید آپدیت می‌شوند، بقیه دست‌نخورده می‌مانند.\nادامه می‌دهید؟`
      )
    ) {
      return;
    }
    await handleVisitorExcel(file);
  }

  if (loading && !data) return <Spinner />;


  return (
    <div className="space-y-4">
      <PageHeader
        title="ویزیتورها"
        subtitle="نمایندگان شرکت‌های پخش و تولید"
        action={
          <AddButton onClick={openAdd}>ویزیتور</AddButton>
        }
      />

      <SubscriptionBanner profile={data?.profile ?? null} trialDays={TRIAL_DAYS} compact role={data?.role} />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      <div className="card flex items-center gap-2 p-2">
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--ink-soft)]"
          placeholder="نام، شرکت یا تلفن ویزیتور…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="ویزیتوری ثبت نشده"
          desc="با دکمه «+ ویزیتور» به سرعت اولین نماینده را اضافه کنید"
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((v) => {
            const conds = data!.conditions.filter((c) => c.visitorId === v.id);
            const notesCount = data!.notes.filter((n) => n.visitorId === v.id).length;
            const lastUpdate = conds.reduce<Date | null>((max, c) => {
              const t = c.updatedAt ? new Date(c.updatedAt) : null;
              if (!t) return max;
              return !max || t > max ? t : max;
            }, null);
            const daysSince = lastUpdate
              ? Math.floor((Date.now() - lastUpdate.getTime()) / 86_400_000)
              : null;
            const fresh = daysSince !== null && daysSince <= 21;
            return (
              <button
                key={v.id}
                onClick={() => setSelected(v)}
                className="card w-full p-4 text-right transition active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold" style={{ color: "var(--ink)" }}>{v.name}</span>
                      {v.company && <Badge color="blue">{v.company}</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px]" style={{ color: "var(--ink-soft)" }}>
                      {v.phone && <span dir="ltr">{faNum(v.phone)}</span>}
                      <span>{faNum(conds.length)} کالا</span>
                      {notesCount > 0 && <span>{faNum(notesCount)} یادداشت</span>}
                    </div>
                    {conds.length > 0 && (
                      <div
                        className="mt-1.5 flex items-center gap-1 text-[10px] font-bold"
                        style={{ color: fresh ? "var(--primary-dark)" : "var(--danger-ink)" }}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: fresh ? "var(--primary)" : "var(--danger)" }}
                        />
                        {daysSince === 0
                          ? "به‌روز — امروز"
                          : fresh
                            ? `به‌روز — ${faNum(daysSince)} روز پیش`
                            : `قدیمی — ${faNum(daysSince)} روز پیش`}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0" style={{ color: "var(--ink-soft)" }}>‹</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---------- Detail ---------- */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.name : ""}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-soft)]">
              {selected.company && <Badge color="blue">{selected.company}</Badge>}
              {selected.phone && (
                <a href={`tel:${selected.phone}`} className="font-medium text-[color:var(--primary-dark)]" dir="ltr">
                  {faNum(selected.phone)}
                </a>
              )}
              {selected.phone && (
                <a
                  href={whatsappUrl(selected.phone, "سلام، وقت بخیر")}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[color:var(--primary-dark)]"
                >
                  واتساپ
                </a>
              )}
              {selected.messengerUsername && (
                <>
                  <a
                    href={telegramUrl(selected.messengerUsername)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[color:var(--primary-dark)]"
                  >
                    تلگرام
                  </a>
                  <a
                    href={baleUrl(selected.messengerUsername)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[color:var(--primary-dark)]"
                  >
                    🅱️ بله
                  </a>
                  <a
                    href={rubikaUrl(selected.messengerUsername)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[color:var(--danger-ink)]"
                  >
                    روبیکا
                  </a>
                </>
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    setForm({
                      name: selected.name,
                      company: selected.company ?? "",
                      phone: selected.phone ?? "",
                      messengerUsername: selected.messengerUsername ?? "",
                      mainProducts: "",
                    });
                    setEditVisitor(selected);
                  }}
                >
                  ویرایش
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs text-[color:var(--danger-ink)]"
                  onClick={() => removeVisitor(selected)}
                >
                  حذف
                </Button>
              </div>
            </div>

            {/* آفر و شرایط پرداخت (فقط متن) */}
            <VisitorTermsField
              key={selected.id}
              visitorId={selected.id}
              initial={selected.noteTerms}
              onSaved={(note) => {
                setSelected({ ...selected, noteTerms: note });
                void load();
              }}
            />

            {/* Conditions */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>کاتالوگ این ویزیتور</h3>
              </div>

              {/* تب‌های ورود سریع: تایپ تکی / پیست لیست / آپلود اکسل */}
              <div className="mb-2 flex gap-1.5 rounded-2xl bg-[color:var(--line)] p-1">
                <button
                  type="button"
                  onClick={() => setAddMode("type")}
                  className={cn(
                    "flex-1 rounded-xl py-1.5 text-[11px] font-bold transition",
                    addMode === "type" ? "bg-[color:var(--surface)] shadow-sm" : ""
                  )}
                  style={{ color: addMode === "type" ? "var(--primary-dark)" : "var(--ink-soft)" }}
                >
                  تایپ تکی
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode("paste")}
                  className={cn(
                    "flex-1 rounded-xl py-1.5 text-[11px] font-bold transition",
                    addMode === "paste" ? "bg-[color:var(--surface)] shadow-sm" : ""
                  )}
                  style={{ color: addMode === "paste" ? "var(--primary-dark)" : "var(--ink-soft)" }}
                >
                  پیست لیست
                </button>
                <label
                  className="flex-1 cursor-pointer rounded-xl py-1.5 text-center text-[11px] font-bold"
                  style={{ color: "var(--ink-soft)" }}
                >
                  لیست جدید از فایل
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.currentTarget.value = "";
                      if (f) setImportFile(f);
                    }}
                  />
                </label>
              </div>

              {addMode === "type" ? (
                <div className="mb-3 rounded-2xl border p-2.5" style={{ borderColor: "var(--line)" }}>
                  <div className="relative flex gap-1.5">
                    <input
                      className="field-input flex-1 py-2 text-xs"
                      placeholder="نام محصول یا برند..."
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !quickBusy) handleQuickAdd();
                      }}
                    />
                    <MicButton onText={(t) => setQuickName((prev) => (prev ? `${prev} ${t}` : t))} />
                    <input
                      className="field-input w-24 py-2 text-xs"
                      placeholder="قیمت"
                      inputMode="numeric"
                      value={quickPrice}
                      onChange={(e) => setQuickPrice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !quickBusy) handleQuickAdd();
                      }}
                    />
                    {quickSuggestions.length > 0 && (
                      <div
                        className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-xl border bg-[color:var(--surface)] shadow-lg"
                        style={{ borderColor: "var(--line)" }}
                      >
                        {quickSuggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setQuickName(s.name)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-right text-[11px] hover:bg-[color:var(--line)]"
                          >
                            <span className="flex-1 truncate" style={{ color: "var(--ink)" }}>{s.name}</span>
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold"
                              style={{
                                background: s.own ? "var(--primary-soft)" : "var(--primary-soft)",
                                color: s.own ? "var(--primary-dark)" : "var(--primary-dark)",
                              }}
                            >
                              {s.own ? "قبلاً از این ویزیتور" : `${faNum(s.otherCount)} ویزیتور دیگر دارند`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-center text-[10px]" style={{ color: "var(--ink-soft)" }}>
                    بنویس و Enter بزن — همان لحظه به کاتالوگ اضافه می‌شود
                  </p>
                  {priceWarning && (
                    <p
                      className="mt-1.5 rounded-lg px-2.5 py-1.5 text-center text-[10.5px] font-medium"
                      style={{
                        background: priceWarning.kind === "up" ? "var(--warning-soft)" : "var(--primary-soft)",
                        color: priceWarning.kind === "up" ? "var(--warning-ink)" : "var(--primary-dark)",
                      }}
                    >
                      {priceWarning.text}
                    </p>
                  )}
                </div>
              ) : (
                <div className="mb-3 rounded-2xl border p-2.5" style={{ borderColor: "var(--line)" }}>
                  <textarea
                    className="field-input min-h-24 text-xs"
                    placeholder={"متن را از واتساپ پیست کن؛ هر خط: نام محصول قیمت\nمثال:\nوازلین آناهیتا 128000"}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  {parsedPasteItems.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {parsedPasteItems.map((it, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-lg px-2 py-1 text-[11px]"
                          style={{ background: it.price ? "var(--primary-soft)" : "var(--warning-soft)" }}
                        >
                          <span style={{ color: "var(--ink)" }}>{it.name}</span>
                          <span className="tnum" style={{ color: it.price ? "var(--primary-dark)" : "var(--warning-ink)" }}>
                            {it.price ? faNum(it.price) : "بدون قیمت"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    onClick={handlePasteAdd}
                    disabled={quickBusy || parsedPasteItems.length === 0}
                    className="mt-2 w-full py-2 text-xs"
                  >
                    ثبت {faNum(parsedPasteItems.length)} مورد در کاتالوگ
                  </Button>
                </div>
              )}

              {selectedConds.length === 0 ? (
                <div
                  className="rounded-2xl border border-dashed px-4 py-6 text-center"
                  style={{ borderColor: "var(--line)" }}
                >
                  <p className="text-xs font-bold" style={{ color: "var(--ink)" }}>هنوز محصولی ثبت نشده</p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--ink-soft)" }}>
                    از کادر بالا شروع کن، یا «لیست جدید از فایل» را بزن
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedConds.length > 12 && (
                    <input
                      value={condQuery}
                      onChange={(e) => setCondQuery(e.target.value)}
                      placeholder={`جستجو در ${faNum(selectedConds.length)} کالای این ویزیتور…`}
                      className="w-full rounded-xl border px-3 py-2 text-xs"
                      style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  )}
                  {(condShowAll || condQuery ? visibleConds : visibleConds.slice(0, 60)).map((c) => {
                    const s = STOCK_BADGE[c.stock];
                    return (
                      <div
                        key={c.id}
                        className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-[color:var(--ink)]">
                              {c.productName}
                              {c.productCode && (
                                <span className="ms-1.5 text-[11px] font-normal text-[color:var(--ink-soft)]" dir="ltr">
                                  {c.productCode}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                              <Badge color={s?.color ?? "slate"}>{s?.label ?? c.stock}</Badge>
                              {c.price != null && <Badge color="blue">{toman(c.price)}</Badge>}
                              {c.cashDiscountPct > 0 && <Badge color="blue">نقد {faNum(c.cashDiscountPct)}٪</Badge>}
                              {c.checkDays > 0 && <Badge color="violet">چک {faNum(c.checkDays)} روز</Badge>}
                              {c.validUntil && <Badge color="amber">تا {faDate(c.validUntil)}</Badge>}
                            </div>
                            {c.offer && (
                              <p className="mt-1 text-[11px] text-[color:var(--ink-soft)]">{c.offer}</p>
                            )}
                            <ConditionDetails c={c} />
                            <TrendPanel
                              history={data!.history.filter(
                                (h) =>
                                  h.visitorId === selected.id &&
                                  h.productId === c.productId
                              )}
                              current={{
                                cashDiscountPct: c.cashDiscountPct,
                                checkDays: c.checkDays,
                              }}
                            />
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {advancedOpen && (
                            <button
                              onClick={() => setCondOpen({ visitorId: selected.id, initial: c })}
                              className="grid size-7 place-items-center rounded-lg bg-[color:var(--line)] text-xs"
                            >
                                                          </button>
                            )}
                            <button
                              onClick={() => removeCondition(c.id)}
                              className="grid size-7 place-items-center rounded-lg bg-[color:var(--danger-soft)] text-xs"
                            >
                                                          </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!condShowAll && !condQuery && visibleConds.length > 60 && (
                    <button type="button" onClick={() => setCondShowAll(true)} className="btn-secondary w-full py-2 text-xs">
                      نمایش همه‌ی {faNum(visibleConds.length)} کالا
                    </button>
                  )}
                  {condQuery && visibleConds.length === 0 && (
                    <p className="py-3 text-center text-[11px]" style={{ color: "var(--ink-soft)" }}>موردی پیدا نشد</p>
                  )}
                </div>
              )}

              {/* پیشرفته: فرم قدیمی شرایط هر محصول (انتخاب محصول لازم دارد)؛ از مسیر اصلی کنار گذاشته شده */}
              <details
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
                className="mt-3 rounded-2xl border px-3"
                style={{ borderColor: "var(--line)" }}
              >
                <summary className="flex min-h-11 cursor-pointer items-center text-xs font-bold" style={{ color: "var(--ink-soft)" }}>
                  پیشرفته: تنظیم دقیق یک محصول
                </summary>
                <div className="space-y-2 pb-3">
                  <p className="text-[11px] leading-5" style={{ color: "var(--ink-soft)" }}>
                    شرایط تسویه و آفرِ کلی ویزیتور را در کادر «شرایط تسویه و آفر» بالای همین صفحه بنویس. این بخش فقط برای تنظیم
                    دقیق یک محصول است (موجودی، انقضا، تخفیف، چک…) و با بازشدنش دکمه‌ی ویرایش کنار هر کالا هم نمایش داده می‌شود.
                  </p>
                  <Button
                    variant="secondary"
                    className="w-full text-xs"
                    onClick={() => setCondOpen({ visitorId: selected.id, initial: null })}
                  >
                    افزودن / تنظیم یک محصول با فرم کامل
                  </Button>
                </div>
              </details>
            </section>

            {importFile && selected && (
              <ListImportDialog
                visitorId={selected.id}
                visitorName={selected.name}
                file={importFile}
                existingCount={selectedConds.length}
                onClose={() => setImportFile(null)}
                onSaved={() => {
                  setImportFile(null);
                  setCondQuery("");
                  load();
                }}
              />
            )}

            {/* Notes */}
            <section>
              <h3 className="mb-2 text-sm font-bold text-[color:var(--ink)]">یادداشت‌ها</h3>
              {selectedNotes.length > 0 && (
                <div className="mb-3 space-y-2">
                  {selectedNotes.map((n) => (
                    <div key={n.id} className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--line)]/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 text-xs leading-5 text-[color:var(--ink)]">{n.body}</p>
                        <button
                          onClick={() => removeNote(n.id)}
                          className="shrink-0 text-xs text-[color:var(--danger-ink)]"
                        >
                                                  </button>
                      </div>
                      <div className="mt-1.5 text-[10px] text-[color:var(--ink-soft)]">{faDateTime(n.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={addNote} className="flex gap-2">
                <Textarea
                  placeholder="یادداشت جدید (با تاریخ ثبت می‌شود)…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="min-h-10 flex-1"
                />
                <Button type="submit" disabled={!noteText.trim()} className="px-3 py-2 text-xs">
                  ثبت
                </Button>
              </form>
            </section>
          </div>
        )}
      </Modal>

      {/* ---------- Quick add ---------- */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="افزودن سریع ویزیتور">
        <form onSubmit={saveVisitor} className="space-y-3">
          {qnText && (
            <div className="rounded-xl border border-[color:var(--primary)] bg-[color:var(--primary-soft)]/60 px-3 py-2 text-[11px] leading-5 text-[color:var(--primary-dark)]">
              از یادداشت: <span className="font-medium">{qnText}</span>
            </div>
          )}
          <Field label="نام ویزیتور">
            <Input
              placeholder="مثلاً: آقای احمدی"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="شرکت">
              <Input
                placeholder="مثلاً: پخش ستاره"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
            <Field label="تلفن">
              <Input
                dir="ltr"
                inputMode="tel"
                placeholder="0912…"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <Field label="آیدی تلگرام/بله/روبیکا (اختیاری)">
            <Input
              dir="ltr"
              placeholder="username بدون @"
              value={form.messengerUsername}
              onChange={(e) =>
                setForm({ ...form, messengerUsername: e.target.value })
              }
            />
          </Field>
          <Field label="۱-۲ کالای اصلی (با ویرگول جدا کنید)">
            <Textarea
              placeholder="مثلاً: شامپو هد اند شولدرز، کرم مرطوب‌کننده"
              value={form.mainProducts}
              onChange={(e) => setForm({ ...form, mainProducts: e.target.value })}
              className="min-h-16"
            />
          </Field>
          <p className="text-[11px] text-[color:var(--ink-soft)]">
            بقیه جزئیات (شرایط، یادداشت‌ها) را بعداً از جزئیات ویزیتور تکمیل کنید.
          </p>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? "در حال ذخیره…" : "افزودن ویزیتور"}
          </Button>
        </form>
      </Modal>

      {/* ---------- Edit visitor ---------- */}
      <Modal open={!!editVisitor} onClose={() => setEditVisitor(null)} title="ویرایش ویزیتور">
        <form onSubmit={saveEdit} className="space-y-3">
          <Field label="نام ویزیتور">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="شرکت">
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
            <Field label="تلفن">
              <Input
                dir="ltr"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <Field label="آیدی تلگرام/بله/روبیکا (اختیاری)">
            <Input
              dir="ltr"
              placeholder="username بدون @"
              value={form.messengerUsername}
              onChange={(e) =>
                setForm({ ...form, messengerUsername: e.target.value })
              }
            />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "در حال ذخیره…" : "ذخیره تغییرات"}
          </Button>
        </form>
      </Modal>

      {/* ---------- Condition form ---------- */}
      {condOpen && (
        <ConditionForm
          open={!!condOpen}
          onClose={() => setCondOpen(null)}
          onSaved={load}
          products={data?.products ?? []}
          visitors={data?.visitors ?? []}
          fixedVisitorId={condOpen.visitorId}
          initial={condOpen.initial}
        />
      )}

    </div>
  );
}
