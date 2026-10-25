"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
import { PageHeader, Button, Badge, Spinner, EmptyState, RefreshButton, Modal } from "@/components/ui";
import {
  clearBasketAction,
  placeBasketOrderAction,
  removeBasketItemAction,
  setBasketQtyAction,
  setBasketVisitorAction,
} from "@/actions/basket";
import { copyText, exportOrderExcel, exportOrderPdf } from "@/lib/export";
import { faNum, toman } from "@/lib/format";
import {
  basketGroupOrder,
  basketGroupText,
  groupBasket,
  listAgeLabel,
  parseQty,
  type BasketGroup,
  type BasketItem,
} from "@/lib/basket";

interface BasketData {
  items: BasketItem[];
}

export default function BasketPage() {
  const { data, error, loading, stale, savedAt, reload } = useOfflineData<BasketData>("/api/basket");
  const groups = useMemo(() => groupBasket(data?.items ?? []), [data]);
  const itemCount = data?.items.length ?? 0;

  const [withPrice, setWithPrice] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pickFor, setPickFor] = useState<BasketItem | null>(null);
  const [orderFor, setOrderFor] = useState<BasketGroup | null>(null);
  const [clearAsk, setClearAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  // کلید یکتای ثبت سفارش هر ویزیتور؛ تا موفقیت ثابت می‌ماند تا لمس دوباره یا تلاش دوباره سفارش تکراری نسازد
  const orderKeys = useRef<Map<string, string>>(new Map());

  async function commitQty(it: BasketItem) {
    const text = editing?.id === it.id ? editing.text : "";
    setEditing(null);
    const qty = parseQty(text);
    if (qty === null) {
      toast.error("تعداد باید عددی بین ۱ و ۹۹۹۹۹ باشد");
      return;
    }
    if (qty === it.qty) return;
    const res = await setBasketQtyAction({ id: it.id, qty });
    if (!res.ok) toast.error(res.error ?? "خطا");
    await reload();
  }

  async function chooseVisitor(it: BasketItem, visitorId: string) {
    setPickFor(null);
    if (visitorId === it.visitorId) return;
    const res = await setBasketVisitorAction({ id: it.id, visitorId });
    if (!res.ok) toast.error(res.error ?? "خطا");
    await reload();
  }

  async function remove(it: BasketItem) {
    const res = await removeBasketItemAction(it.id);
    if (!res.ok) toast.error(res.error ?? "خطا");
    await reload();
  }

  async function clearAll() {
    setClearAsk(false);
    const res = await clearBasketAction();
    if (!res.ok) toast.error(res.error ?? "خطا");
    else toast.success("لیست خرید پاک شد");
    await reload();
  }

  async function copy(g: BasketGroup) {
    const ok = await copyText(basketGroupText(g, { withPrice }));
    if (ok) toast.success("متن سفارش کپی شد");
    else toast.error("کپی ممکن نشد");
  }

  async function share(g: BasketGroup) {
    const text = basketGroupText(g, { withPrice });
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
      } catch {
        /* کاربر پنجره را بست */
      }
      return;
    }
    const ok = await copyText(text);
    if (ok) toast.success("اشتراک‌گذاری در این دستگاه نیست؛ متن کپی شد");
    else toast.error("کپی ممکن نشد");
  }

  async function exportFile(g: BasketGroup, kind: "excel" | "pdf") {
    try {
      if (kind === "excel") await exportOrderExcel(basketGroupOrder(g));
      else await exportOrderPdf(basketGroupOrder(g));
    } catch {
      toast.error("ساخت فایل ممکن نشد");
    }
  }

  async function placeOrder(g: BasketGroup) {
    if (!g.visitorId) return;
    let key = orderKeys.current.get(g.visitorId);
    if (!key) {
      key = `basket-${crypto.randomUUID()}`;
      orderKeys.current.set(g.visitorId, key);
    }
    setBusy(true);
    const res = await placeBasketOrderAction({ visitorId: g.visitorId, clientKey: key });
    setBusy(false);
    setOrderFor(null);
    if (res.ok) {
      orderKeys.current.delete(g.visitorId);
      toast.success(res.orderNo ? `سفارش شماره ${faNum(res.orderNo)} ثبت شد` : "سفارش ثبت شد");
    } else toast.error(res.error ?? "ثبت سفارش ناموفق بود");
    await reload();
  }

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="لیست خرید"
        subtitle="کالاها را به‌تفکیک ویزیتور ببین، متن سفارش را بفرست یا ثبت کن"
        action={
          <div className="flex gap-2">
            <RefreshButton onClick={() => void reload()} />
            <Link href="/shortages" className="btn-secondary px-4 text-sm">
              کسری‌ها
            </Link>
          </div>
        }
      />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}
      <OfflineBadge stale={stale} savedAt={savedAt} />

      {itemCount === 0 ? (
        <EmptyState
          title="لیست خرید خالی است"
          desc="از نتایج جستجو روی «افزودن» بزن، یا در صفحه‌ی کسری‌ها «افزودن همه‌ی کسری‌ها» را بزن"
          action={
            <Link href="/shortages" className="btn-primary px-5 text-sm">
              رفتن به کسری‌ها
            </Link>
          }
        />
      ) : (
        <>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-[color:var(--line)] px-3 text-xs font-medium text-[color:var(--ink-soft)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={withPrice}
              onChange={(e) => setWithPrice(e.target.checked)}
            />
            قیمت را در متن ارسالی بیاور
          </label>

          {groups.map((g) => (
            <section key={g.key} className="card space-y-3 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-[color:var(--ink)]">{g.visitorName}</h2>
                <Badge color="teal">{faNum(g.items.length)} قلم</Badge>
                <Badge color="slate">مجموع تعداد: {faNum(g.totalQty)}</Badge>
                {g.hasPrices && <Badge color="slate">{toman(g.totalAmount)}</Badge>}
              </div>

              {g.visitorId && g.stale && (
                <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium leading-5 text-[color:var(--warning-ink)]">
                  لیست این ویزیتور {faNum(g.ageDays ?? 0)} روز قدیمی است؛ قیمت‌ها را قبل از سفارش بررسی کن.
                </p>
              )}
              {!g.visitorId && (
                <p className="rounded-xl bg-[color:var(--line)] px-3 py-2 text-xs leading-5 text-[color:var(--ink-soft)]">
                  برای این کالاها ویزیتوری انتخاب نشده است؛ ویزیتور را عوض کن یا کالا را حذف کن.
                </p>
              )}

              <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 py-2.5" style={{ borderColor: "var(--line)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold leading-5 text-[color:var(--ink)]">{it.productName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--ink-soft)]">
                        {it.price !== null && <span>قیمت هنگام افزودن: {toman(it.price)}</span>}
                        {it.unavailable && <Badge color="red">ناموجود نزد همه</Badge>}
                        {!it.unavailable && it.visitorOut && <Badge color="amber">نزد این ویزیتور ناموجود شد</Badge>}
                      </div>
                      {it.alternatives.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPickFor(it)}
                          className="mt-1 min-h-11 text-[11px] font-bold text-[color:var(--primary-dark)]"
                        >
                          تغییر ویزیتور ({faNum(it.alternatives.length)} گزینه)
                        </button>
                      )}
                    </div>

                    {editing?.id === it.id ? (
                      <input
                        autoFocus
                        inputMode="numeric"
                        aria-label="تعداد"
                        className="field-input !w-20 shrink-0 !px-2 text-center"
                        value={editing.text}
                        onChange={(e) => setEditing({ id: it.id, text: e.target.value })}
                        onBlur={() => void commitQty(it)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        aria-label={`ویرایش تعداد ${it.productName}`}
                        onClick={() => setEditing({ id: it.id, text: faNum(it.qty) })}
                        className="btn-secondary !w-16 shrink-0 !px-2 text-sm font-bold"
                      >
                        {faNum(it.qty)}
                      </button>
                    )}

                    <button
                      type="button"
                      aria-label={`حذف ${it.productName}`}
                      onClick={() => void remove(it)}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-[color:var(--danger-ink)] transition active:scale-95"
                      style={{ background: "var(--danger-soft)" }}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>

              {g.orderable && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Button variant="secondary" className="text-sm" onClick={() => void copy(g)}>
                      کپی متن
                    </Button>
                    <Button variant="secondary" className="text-sm" onClick={() => void share(g)}>
                      ارسال
                    </Button>
                    <Button variant="secondary" className="text-sm" onClick={() => void exportFile(g, "excel")}>
                      اکسل
                    </Button>
                    <Button variant="secondary" className="text-sm" onClick={() => void exportFile(g, "pdf")}>
                      PDF
                    </Button>
                  </div>
                  <Button className="w-full text-sm" onClick={() => setOrderFor(g)} disabled={busy}>
                    ثبت به‌عنوان سفارش
                  </Button>
                </div>
              )}
            </section>
          ))}

          <div className="pt-1">
            {clearAsk ? (
              <div className="flex items-center gap-2">
                <Button variant="danger" className="flex-1 text-sm" onClick={() => void clearAll()}>
                  بله، همه پاک شود
                </Button>
                <Button variant="secondary" className="flex-1 text-sm" onClick={() => setClearAsk(false)}>
                  انصراف
                </Button>
              </div>
            ) : (
              <Button variant="ghost" className="w-full text-sm" onClick={() => setClearAsk(true)}>
                پاک‌کردن همه
              </Button>
            )}
          </div>
        </>
      )}

      <Modal open={pickFor !== null} onClose={() => setPickFor(null)} title="انتخاب ویزیتور">
        {pickFor && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-[color:var(--ink)]">{pickFor.productName}</p>
            {pickFor.alternatives.map((a) => (
              <button
                key={a.visitorId}
                type="button"
                onClick={() => void chooseVisitor(pickFor, a.visitorId)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-right transition active:scale-[0.99]"
                style={{
                  borderColor: a.visitorId === pickFor.visitorId ? "var(--primary)" : "var(--line)",
                  background: a.visitorId === pickFor.visitorId ? "var(--primary-soft)" : "var(--surface)",
                }}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[color:var(--ink)]">{a.visitorName}</span>
                  <span
                    className="mt-0.5 inline-block text-[11px]"
                    style={a.stale ? { color: "var(--warning-ink)", fontWeight: 700 } : { color: "var(--ink-soft)" }}
                  >
                    لیست: {listAgeLabel(a.ageDays)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] font-bold text-[color:var(--primary-dark)]">{toman(a.price)}</span>
                  {a.cheapest && <Badge color="green">ارزان‌ترین</Badge>}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={orderFor !== null} onClose={() => setOrderFor(null)} title="ثبت به‌عنوان سفارش">
        {orderFor && (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[color:var(--ink)]">
              {faNum(orderFor.items.length)} قلم برای «{orderFor.visitorName}» به‌عنوان سفارش ثبت شود و از لیست خرید برداشته شود؟
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 text-sm" disabled={busy} onClick={() => void placeOrder(orderFor)}>
                {busy ? "در حال ثبت…" : "ثبت سفارش"}
              </Button>
              <Button variant="secondary" className="flex-1 text-sm" onClick={() => setOrderFor(null)}>
                انصراف
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
