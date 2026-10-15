"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { offlineFetch } from "@/lib/offline";
import { OfflineBadge } from "@/components/offline-badge";
import { TrendPanel } from "@/components/trend";
import {
  PageHeader,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Spinner,
  EmptyState,
  AddButton,
  RefreshButton,
} from "@/components/ui";
import { ConditionForm } from "@/components/condition-form";
import {
  addProductAction,
  updateProductAction,
  deleteProductAction,
  addProductFromBaseAction,
  bulkAddProductsAction,
} from "@/actions/products";
import { setShortageAction } from "@/actions/shortages";
import { deleteConditionAction } from "@/actions/visitors";
import { conditionScore, whatsappUrl } from "@/lib/domain";
import { cn, faDate, faDateShort, faNum, toman } from "@/lib/format";
import { CATEGORIES, STOCKS, type CategoryKey } from "@/lib/config";
import type {
  Product,
  Visitor,
  Condition,
  ConditionHistory,
} from "@/lib/types";

interface BaseItem {
  id: string;
  name: string;
  category: string;
}

interface ProductsData {
  products: Product[];
  conditions: Condition[];
  visitors: Visitor[];
  history: ConditionHistory[];
}

const STOCK_BADGE: Record<string, { color: "green" | "amber" | "red"; label: string }> = {
  in: { color: "green", label: "دارد" },
  low: { color: "amber", label: "کم" },
  out: { color: "red", label: "ندارد" },
};

export default function ProductsPage() {
  const router = useRouter();
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<ProductsData>("/api/products");
  const load = reload;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [compareProduct, setCompareProduct] = useState<Product | null>(null);

  // --- فیلترهای شرط خرید ویزیتورها (روی visitor_products اعمال میشوند) ---
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minCashPct, setMinCashPct] = useState(0); // 0 | 10 | 20 | 30
  const [checkFilter, setCheckFilter] = useState("any"); // any | has | 30 | 60 | 90
  const [offerFilter, setOfferFilter] = useState("any"); // any | only
  const [stockFilter, setStockFilter] = useState("all"); // all | in | low
  const [addOpen, setAddOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [condOpen, setCondOpen] = useState<{ productId: string; initial: Condition | null } | null>(null);

  const [form, setForm] = useState({ name: "", code: "", category: "cosmetic" });
  const [busy, setBusy] = useState(false);
  const [baseList, setBaseList] = useState<BaseItem[] | null>(null);
  const [baseQ, setBaseQ] = useState("");
  const [showManual, setShowManual] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // تبدیل یادداشت سریع به کالا (از صفحه یادداشتها با #note=)
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
          const firstLine = note.body.split("\n")[0].slice(0, 80);
          setForm({ name: firstLine, code: "", category: "cosmetic" });
          setShowManual(true);
          setBaseQ("");
          setAddOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  // داده‌ها از طریق useOfflineData بارگذاری می‌شود

  const baseResults = useMemo(() => {
    if (!baseList) return [];
    const query = baseQ.trim();
    const list = query
      ? baseList.filter((b) => b.name.includes(query))
      : baseList;
    return list.slice(0, 30);
  }, [baseList, baseQ]);

  /** آیا شرط خرید یک ویزیتور با فیلترهای انتخابی مطابقت دارد؟ */
  function matchesFilters(c: Condition): boolean {
    if (minCashPct > 0 && c.cashDiscountPct < minCashPct) return false;
    if (checkFilter === "has" && c.checkDays <= 0) return false;
    if (
      (checkFilter === "30" || checkFilter === "60" || checkFilter === "90") &&
      c.checkDays < Number(checkFilter)
    )
      return false;
    if (offerFilter === "only" && !(c.offer && c.offer.trim())) return false;
    if (stockFilter !== "all" && c.stock !== stockFilter) return false;
    return true;
  }

  /** شمارنده‌ی فیلترهای فعال */
  const activeFilterCount = useMemo(
    () =>
      (minCashPct > 0 ? 1 : 0) +
      (checkFilter !== "any" ? 1 : 0) +
      (offerFilter === "only" ? 1 : 0) +
      (stockFilter !== "all" ? 1 : 0),
    [minCashPct, checkFilter, offerFilter, stockFilter]
  );

  function resetFilters() {
    setMinCashPct(0);
    setCheckFilter("any");
    setOfferFilter("any");
    setStockFilter("all");
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = q.trim();
    return data.products.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      // جستجوی متنی: نام/کد کالا یا نام ویزیتور/شرکت در شرایط همان کالا
      if (!query) return true;
      if (p.name.includes(query) || (p.code ?? "").includes(query)) return true;
      return data.conditions.some(
        (c) =>
          c.productId === p.id &&
          ((c.visitorName ?? "").includes(query) ||
            (c.visitorCompany ?? "").includes(query))
      );
    });
  }, [data, q, cat]);

  /** شرطهای هر کالا: اول فیلتر میشود، بعد بر اساس امتیاز مرتب میگردد */
  function filteredConditions(productId: string): Condition[] {
    if (!data) return [];
    return data.conditions
      .filter((c) => c.productId === productId && matchesFilters(c))
      .sort((a, b) => conditionScore(b) - conditionScore(a));
  }

  const filtersActive = activeFilterCount > 0;

  async function openAdd() {
    setForm({ name: "", code: "", category: "cosmetic" });
    setShowManual(false);
    setBaseQ("");
    setAddOpen(true);
    // کاتالوگ پایه یک بار بارگیری می‌شود (کش آفلاین هم دارد)
    if (!baseList) {
      const r = await offlineFetch<{ products: BaseItem[] }>("/api/base-products");
      if (r.data?.products) setBaseList(r.data.products);
    }
  }

  async function addFromBase(id: string) {
    setBusy(true);
    const res = await addProductFromBaseAction(id);
    setBusy(false);
    if (res.ok) {
      toast.success("کالا به لیست شما اضافه شد");
      setAddOpen(false);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  /** ورود دسته‌ای از اکسل: نام / کد / دسته‌بندی — تکراری‌ها بدون خطا رد می‌شوند */
  async function handleExcel(file: File) {
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        toast.error("برگه‌ای در فایل پیدا نشد");
        return;
      }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      const items: Array<{ name: string; code?: string; category?: string }> = [];
      rows.forEach((row, i) => {
        const name = String(row[0] ?? "").trim();
        if (i === 0 && /نام/i.test(name)) return; // ردیف عنوان
        if (!name) return;
        const code = String(row[1] ?? "").trim();
        const catRaw = String(row[2] ?? "").trim();
        let category: string | undefined;
        if (/آرایش|cosmetic/i.test(catRaw)) category = "cosmetic";
        else if (/بهداشت|hygiene/i.test(catRaw)) category = "hygiene";
        else if (/تجهیز|equipment/i.test(catRaw)) category = "equipment";
        items.push({ name, code: code || undefined, category });
      });
      if (items.length === 0) {
        toast.error("ردیف معتبری در فایل پیدا نشد (ستون اول باید نام کالا باشد)");
        return;
      }
      const res = await bulkAddProductsAction({ items });
      if (res.ok) {
        const skipped = (res.skipped ?? 0) > 0 ? ` — ${faNum(res.skipped ?? 0)} تکراری رد شد` : "";
        toast.success(`${faNum(res.added ?? 0)} کالا اضافه شد${skipped}`);
        load();
      } else toast.error(res.error ?? "خطا در ورود فایل");
    } catch {
      toast.error("خواندن فایل ناموفق بود — فرمت xlsx/xls/csv باشد");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openEdit(p: Product) {
    setForm({ name: p.name, code: p.code ?? "", category: p.category });
    setEditProduct(p);
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = editProduct
      ? await updateProductAction({ id: editProduct.id, ...form })
      : await addProductAction(form);
    setBusy(false);
    if (res.ok) {
      toast.success(editProduct ? "کالا ویرایش شد" : "کالا اضافه شد");
      setAddOpen(false);
      setEditProduct(null);
      load();
    } else {
      toast.error(res.error ?? "خطا در ذخیره");
    }
  }

  /** علامت زدن / برداشتن «کسری دارم» روی یک کالا */
  async function toggleShort(p: Product) {
    const res = await setShortageAction({ productId: p.id, short: !p.isShort });
    if (res.ok) {
      toast.success(res.short ? "به لیست کسری‌ها اضافه شد" : "کسری رفع شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function removeProduct(p: Product) {
    if (!confirm(`کالای «${p.name}» غیرفعال شود؟`)) return;
    const res = await deleteProductAction(p.id);
    if (res.ok) {
      toast.success("کالا غیرفعال شد");
      setCompareProduct(null);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function removeCondition(id: string) {
    if (!confirm("این شرط حذف شود؟")) return;
    const res = await deleteConditionAction(id);
    if (res.ok) {
      toast.success("شرط حذف شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="جستجوی کالا و مقایسه خرید"
        subtitle="از کی بخرم؟ شرایط همه ویزیتورها، مرتب‌شده بر اساس بهترین ترکیب"
        action={
          <div className="flex gap-2">
            <RefreshButton onClick={() => load()} />
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              className="px-3 text-xs"
            >
              اکسل
            </Button>
            <AddButton onClick={openAdd}>کالا</AddButton>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleExcel(f);
              }}
            />
          </div>
        }
      />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      <div className="card flex items-center gap-2 p-2">
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--ink-soft)]"
          placeholder="نام کالا، کد یا نام ویزیتور/شرکت…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* ---------- پنل فیلترها (آکاردئون موبایلی) ---------- */}
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] shadow-sm">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className={cn(
            "flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition",
            filtersOpen ? "bg-[color:var(--line)]" : "bg-[color:var(--surface)]"
          )}
        >
          <span className={cn("flex items-center gap-2", filtersActive && "text-[color:var(--primary-dark)]")}>
            فیلتر شرایط خرید
            {filtersActive && (
              <span className="grid size-5 place-items-center rounded-full bg-[color:var(--primary-dark)] text-[10px] font-bold text-[color:var(--on-primary)]">
                {faNum(activeFilterCount)}
              </span>
            )}
          </span>
          <span className={cn("text-[color:var(--ink-soft)] transition-transform", filtersOpen && "rotate-180")}>
            ▼
          </span>
        </button>

        {filtersOpen && (
          <div className="space-y-3 border-t border-[color:var(--line)] p-4">
            <div>
              <label className="field-label">حداقل درصد نقدی</label>
              <div className="flex gap-1.5">
                {[
                  { v: 0, l: "بدون فیلتر" },
                  { v: 10, l: "۱۰٪+" },
                  { v: 20, l: "۲۰٪+" },
                  { v: 30, l: "۳۰٪+" },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setMinCashPct(opt.v)}
                    className={cn(
                      "flex-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition",
                      minCashPct === opt.v
                        ? "bg-[color:var(--primary-dark)] text-[color:var(--on-primary)]"
                        : "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)]"
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label">شرایط چک</label>
              <div className="flex gap-1.5">
                {[
                  { v: "any", l: "بدون فیلتر" },
                  { v: "has", l: "دارد چک" },
                  { v: "30", l: "۳۰ روز+" },
                  { v: "60", l: "۶۰ روز+" },
                  { v: "90", l: "۹۰ روز+" },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setCheckFilter(opt.v)}
                    className={cn(
                      "flex-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition",
                      checkFilter === opt.v
                        ? "bg-[color:var(--primary-dark)] text-[color:var(--on-primary)]"
                        : "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)]"
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="field-label">آفر</label>
                <Select
                  value={offerFilter}
                  onChange={(e) => setOfferFilter(e.target.value)}
                  className="py-2 text-xs"
                >
                  <option value="any">بدون فیلتر</option>
                  <option value="only">فقط با آفر</option>
                </Select>
              </div>
              <div>
                <label className="field-label">موجودی</label>
                <Select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value)}
                  className="py-2 text-xs"
                >
                  <option value="all">همه</option>
                  <option value="in">فقط موجود</option>
                  <option value="low">فقط کم‌موجودی</option>
                </Select>
              </div>
            </div>

            {filtersActive && (
              <button
                onClick={resetFilters}
                className="w-full rounded-xl border border-[color:var(--line)] py-2 text-[11px] font-medium text-[color:var(--ink-soft)] transition hover:border-[color:var(--danger)]/30 hover:text-[color:var(--danger-ink)]"
              >
                حذف همه فیلترها
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "cosmetic", "hygiene", "equipment"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition",
              cat === c
                ? "bg-[color:var(--primary-dark)] text-[color:var(--on-primary)]"
                : "border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)]"
            )}
          >
            {c === "all" ? "همه" : CATEGORIES[c as CategoryKey]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={q || cat !== "all" ? "کالایی پیدا نشد" : "هنوز کالایی ثبت نشده"}
          desc="با دکمه «+ کالا» اولین کالا را ثبت کنید"
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((p) => {
            const conds = filteredConditions(p.id);
            const best = conds[0];
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setCompareProduct(p)}
                className="card w-full cursor-pointer p-4 text-right transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-[color:var(--ink)]">{p.name}</span>
                      {p.code && (
                        <span className="shrink-0 text-[11px] text-[color:var(--ink-soft)]" dir="ltr">
                          {p.code}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge color="violet">{CATEGORIES[p.category as CategoryKey] ?? p.category}</Badge>
                      {p.isShort && <Badge color="red">کسری</Badge>}
                      <span className="text-[11px] text-[color:var(--ink-soft)]">
                        {filtersActive
                          ? `${faNum(conds.length)} ویزیتور با این فیلترها`
                          : `${faNum(conds.length)} ویزیتور ثبت شرایط دارد`}
                      </span>
                    </div>
                    {best ? (
                      <div className="mt-2 rounded-xl bg-[color:var(--primary-soft)]/70 px-3 py-2 text-[11px] leading-5 text-[color:var(--primary-dark)]">
                        <b>{best.visitorName}</b>
                        {best.visitorCompany ? ` (${best.visitorCompany})` : ""} ·{" "}
                        {STOCK_BADGE[best.stock]?.label ?? best.stock}
                        {best.cashDiscountPct > 0 && <> · نقد {faNum(best.cashDiscountPct)}٪</>}
                        {best.checkDays > 0 && <> · چک {faNum(best.checkDays)} روز</>}
                        {best.offer ? ` · ${best.offer}` : ""}
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-[color:var(--ink-soft)]">
                        هنوز شرایطی ثبت نشده — برای مقایسه باز کنید
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleShort(p);
                      }}
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold transition",
                        p.isShort
                          ? "bg-[color:var(--danger-soft)] text-[color:var(--danger-ink)]"
                          : "bg-[color:var(--line)] text-[color:var(--ink-soft)] hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger-ink)]"
                      )}
                    >
                      {p.isShort ? "کسری دارم" : "کسری دارم؟"}
                    </button>
                    <span className="text-[color:var(--ink-soft)]">‹</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Comparison modal ---------- */}
      <Modal
        open={!!compareProduct}
        onClose={() => setCompareProduct(null)}
        title={compareProduct ? `مقایسه شرایط: ${compareProduct.name}` : ""}
      >
        {compareProduct && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  router.push(`/price-requests?new=1&product=${compareProduct.id}`);
                }}
              >
                درخواست قیمت برای این کالا
              </Button>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => setCondOpen({ productId: compareProduct.id, initial: null })}
              >
                + ثبت شرایط ویزیتور
              </Button>
            </div>

            <p className="rounded-xl bg-[color:var(--line)] px-3 py-2 text-[10px] leading-4 text-[color:var(--ink-soft)]">
              ترتیب بر اساس امتیاز: موجودی (تا ۲۰۰) + نقدی (۲×٪) + چک (۳×روز) + آفر (۱۵)
              {filtersActive && " — ابتدا فیلتر اعمال میشود، سپس مرتبسازی"}
            </p>

            {filteredConditions(compareProduct.id).length === 0 ? (
              filtersActive ? (
                <EmptyState
                  title="ویزیتوری با این فیلترها پیدا نشد"
                  desc="فیلترها را تغییر دهید یا «حذف همه فیلترها» را بزنید"
                />
              ) : (
                <EmptyState title="شرایطی ثبت نشده" desc="از دکمه بالا اولین شرط را ثبت کنید" />
              )
            ) : (
              <div className="space-y-2">
                {filteredConditions(compareProduct.id).map((c, idx) => {
                    const stock = STOCK_BADGE[c.stock];
                    const wa = whatsappUrl(
                      c.visitorPhone,
                      `سلام، قیمت و شرایط کالای «${compareProduct.name}» را اعلام بفرمایید.`
                    );
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "rounded-2xl border p-3",
                          idx === 0 ? "border-[color:var(--primary)] bg-[color:var(--primary-soft)]" : "border-[color:var(--line)] bg-[color:var(--surface)]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {idx === 0 && <Badge color="teal">پیشنهاد اول</Badge>}
                              <span className="text-sm font-bold text-[color:var(--ink)]">{c.visitorName}</span>
                              {c.visitorCompany && (
                                <span className="text-[11px] text-[color:var(--ink-soft)]">{c.visitorCompany}</span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <Badge color={stock?.color ?? "slate"}>{stock?.label ?? c.stock}</Badge>
                              {c.price != null && <Badge color="blue">{toman(c.price)}</Badge>}
                              {c.cashDiscountPct > 0 && (
                                <Badge color="blue">نقد {faNum(c.cashDiscountPct)}٪</Badge>
                              )}
                              {c.checkDays > 0 && (
                                <Badge color="violet">چک {faNum(c.checkDays)} روز</Badge>
                              )}
                              {c.validUntil && (
                                <Badge color={new Date(c.validUntil) < new Date() ? "red" : "amber"}>
                                  اعتبار تا {faDateShort(c.validUntil)}
                                </Badge>
                              )}
                            </div>
                            {c.offer && (
                              <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">
                                {c.offer}
                              </p>
                            )}
                            <TrendPanel
                              history={data!.history.filter(
                                (h) =>
                                  h.visitorId === c.visitorId &&
                                  h.productId === c.productId
                              )}
                              current={{
                                cashDiscountPct: c.cashDiscountPct,
                                checkDays: c.checkDays,
                              }}
                            />
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Badge color="slate">امتیاز {faNum(conditionScore(c))}</Badge>
                            <div className="flex gap-1">
                              {c.visitorPhone && (
                                <a
                                  href={`tel:${c.visitorPhone}`}
                                  className="grid size-7 place-items-center rounded-lg bg-[color:var(--line)] text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                                                  </a>
                              )}
                              {wa && (
                                <a
                                  href={wa}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="grid size-7 place-items-center rounded-lg bg-[color:var(--primary-soft)] text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                                                  </a>
                              )}
                              <button
                                onClick={() =>
                                  setCondOpen({ productId: compareProduct.id, initial: c })
                                }
                                className="grid size-7 place-items-center rounded-lg bg-[color:var(--line)] text-xs"
                              >
                                                              </button>
                              <button
                                onClick={() => removeCondition(c.id)}
                                className="grid size-7 place-items-center rounded-lg bg-[color:var(--danger-soft)] text-xs"
                              >
                                                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {compareProduct && (
              <div className="flex items-center justify-between gap-2 border-t border-[color:var(--line)] pt-3">
                <Button variant="ghost" className="text-xs text-[color:var(--danger-ink)]" onClick={() => removeProduct(compareProduct)}>
                  غیرفعال کردن کالا
                </Button>
                <Button
                  variant="secondary"
                  className={cn(
                    "text-xs",
                    compareProduct.isShort &&
                      "border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] text-[color:var(--danger-ink)]"
                  )}
                  onClick={() => toggleShort(compareProduct)}
                >
                  {compareProduct.isShort ? "رفع کسری" : "کسری دارم"}
                </Button>
                <Button
                  variant="secondary"
                  className="text-xs"
                  onClick={() => openEdit(compareProduct)}
                >
                  ویرایش کالا
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- Add / edit product ---------- */}
      <Modal
        open={addOpen || !!editProduct}
        onClose={() => {
          setAddOpen(false);
          setEditProduct(null);
        }}
        title={editProduct ? "ویرایش کالا" : "کالای جدید"}
      >
        {editProduct ? (
          <form onSubmit={saveProduct} className="space-y-3">
            <Field label="نام کالا">
              <Input
                placeholder="مثلاً: شامپو ضد شوره ۳۰۰ میل"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="کد / بارکد (اختیاری)">
              <Input
                dir="ltr"
                placeholder="کد شرکت یا IRC"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Field>
            <Field label="دسته‌بندی">
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="cosmetic">آرایشی</option>
                <option value="hygiene">بهداشتی</option>
                <option value="equipment">تجهیزات</option>
              </Select>
            </Field>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "در حال ذخیره…" : "ذخیره تغییرات"}
            </Button>
          </form>
        ) : showManual ? (
          <div className="space-y-3">
            {qnText && (
              <div className="rounded-xl border border-[color:var(--primary)] bg-[color:var(--primary-soft)] px-3 py-2 text-[11px] leading-5 text-[color:var(--primary-dark)]">
                از یادداشت: <span className="font-medium">{qnText}</span>
              </div>
            )}
            <form onSubmit={saveProduct} className="space-y-3">
              <Field label="نام کالا">
                <Input
                  placeholder="مثلاً: شامپو ضد شوره ۳۰۰ میل"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
              <Field label="کد / بارکد (اختیاری)">
                <Input
                  dir="ltr"
                  placeholder="کد شرکت یا IRC"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
              <Field label="دسته‌بندی">
                <Select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="cosmetic">آرایشی</option>
                  <option value="hygiene">بهداشتی</option>
                  <option value="equipment">تجهیزات</option>
                </Select>
              </Field>
              <Button type="submit" variant="primary" disabled={busy} className="w-full">
                {busy ? "در حال ذخیره…" : "افزودن دستی کالا"}
              </Button>
            </form>
            <Button
              variant="ghost"
              className="w-full text-xs"
              onClick={() => setShowManual(false)}
            >
              ← بازگشت به جستجوی کاتالوگ
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="card flex items-center gap-2 p-2">
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--ink-soft)]"
                placeholder="جستجوی زنده در کاتالوگ مشترک (۲۵۰+ کالای پرکاربرد)…"
                value={baseQ}
                onChange={(e) => setBaseQ(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pe-1">
              {baseResults.length === 0 ? (
                <p className="rounded-xl bg-[color:var(--line)] px-3 py-4 text-center text-xs text-[color:var(--ink-soft)]">
                  {baseList === null
                    ? "در حال بارگیری کاتالوگ…"
                    : "در کاتالوگ پیدا نشد — از پایین به‌صورت دستی اضافه کنید"}
                </p>
              ) : (
                baseResults.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--line)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-[color:var(--ink)]">{b.name}</div>
                      <Badge color="violet" className="mt-0.5">
                        {CATEGORIES[b.category as CategoryKey] ?? b.category}
                      </Badge>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 px-2.5 py-1 text-[11px]"
                      disabled={busy}
                      onClick={() => addFromBase(b.id)}
                    >
                      ＋ افزودن
                    </Button>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => {
                setForm({ name: baseQ.trim(), code: "", category: "cosmetic" });
                setShowManual(true);
              }}
              className="w-full rounded-xl border border-dashed border-[color:var(--line)] px-3 py-2.5 text-xs font-medium text-[color:var(--ink-soft)] transition hover:border-[color:var(--primary)] hover:text-[color:var(--primary-dark)]"
            >
              در کاتالوگ پیدا نشد؟ افزودن دستی
            </button>
          </div>
        )}
      </Modal>

      {/* ---------- Condition form ---------- */}
      {condOpen && (
        <ConditionForm
          open={!!condOpen}
          onClose={() => setCondOpen(null)}
          onSaved={load}
          visitors={data?.visitors ?? []}
          products={data?.products ?? []}
          fixedProductId={condOpen.productId}
          initial={condOpen.initial}
        />
      )}
    </div>
  );
}
