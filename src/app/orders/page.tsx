"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { SubscriptionBanner } from "@/components/sub-banner";
import { TRIAL_DAYS } from "@/lib/config";
import { OfflineBadge } from "@/components/offline-badge";
import { JalaliDatePicker } from "@/lib/jalali";
import {
  PageHeader,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Textarea,
  Spinner,
  EmptyState,
  AddButton,
} from "@/components/ui";
import {
  createOrderAction,
  setOrderStatusAction,
  deleteOrderAction,
  restoreOrderAction,
  purgeOrderAction,
} from "@/actions/orders";
import { addChequeAction } from "@/actions/cheques";
import { exportOrderPdf, exportOrderExcel, copyText, orderPlainText } from "@/lib/export";
import { orderTotal } from "@/lib/domain";
import { newClientKey } from "@/lib/client-key";
import { faDate, faDateTime, faNum, toNum, toman } from "@/lib/format";
import { ORDER_STATUS, type OrderStatusKey } from "@/lib/config";
import type { Order, OrderItem, Visitor, Product } from "@/lib/types";

interface OrdersData {
  orders: Order[];
  trash: Order[];
  items: OrderItem[];
  visitors: Visitor[];
  products: Product[];
  pharmacyName: string | null;
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

const STATUS_BADGE: Record<string, { color: "blue" | "green" | "red"; label: string }> = {
  registered: { color: "blue", label: ORDER_STATUS.registered },
  delivered: { color: "green", label: ORDER_STATUS.delivered },
  cancelled: { color: "red", label: ORDER_STATUS.cancelled },
};

interface DraftItem {
  key: number;
  productName: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
}

export default function OrdersPage() {
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<OrdersData>("/api/orders");
  const load = reload;
  const [newOpen, setNewOpen] = useState(false);
  const [visitorId, setVisitorId] = useState("");
  const [note, setNote] = useState("");
  const [settlementType, setSettlementType] = useState<"cash" | "cheque">("cash");
  const [settlementDays, setSettlementDays] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { key: 1, productName: "", qty: "1", unitPrice: "", discountPct: "0" },
  ]);
  const [busy, setBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // کلید ثبت هنگام باز شدن فرم ساخته می‌شود و تا بستن آن (حتی با تلاش دوباره) ثابت می‌ماند
  const clientKeyRef = useRef("");
  const submitRef = useRef(false);
  const [detail, setDetail] = useState<Order | null>(null);
  const [qnText, setQnText] = useState("");
  // چک اختیاری هنگام ثبت سفارش (کاملاً دستی)
  const [chequeOpen, setChequeOpen] = useState(false);
  const [chequeAmount, setChequeAmount] = useState("");
  const [chequeDue, setChequeDue] = useState("");

  useEffect(() => {
    if (newOpen) clientKeyRef.current = newClientKey();
  }, [newOpen]);

  // تبدیل یادداشت سریع به سفارش (از صفحه یادداشتها با #note=)
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
          setNote(note.body.slice(0, 500));
          setNewOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  // هنگام بارگذاری مجدد داده‌ها، سفارش باز را تازه نگه می‌دارد
  useEffect(() => {
    setDetail((d) => (d && data ? data.orders.find((o) => o.id === d.id) ?? d : d));
  }, [data]);

  const ordersWithItems = useMemo(() => {
    if (!data) return [];
    return data.orders.map((o) => ({
      ...o,
      items: data.items.filter((it) => it.orderId === o.id),
    }));
  }, [data]);

  const trashWithItems = useMemo(() => {
    if (!data) return [];
    return (data.trash ?? []).map((o) => ({
      ...o,
      items: data.items.filter((it) => it.orderId === o.id),
    }));
  }, [data]);

  const draftTotal = items.reduce(
    (sum, it) =>
      sum +
      Math.round(
        (toNum(it.qty) || 1) * (toNum(it.unitPrice) || 0) * (1 - (toNum(it.discountPct) || 0) / 100)
      ),
    0
  );

  function updateItem(key: number, patch: Partial<DraftItem>) {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((list) => [
      ...list,
      { key: Date.now(), productName: "", qty: "1", unitPrice: "", discountPct: "0" },
    ]);
  }

  function removeItem(key: number) {
    setItems((list) => (list.length > 1 ? list.filter((it) => it.key !== key) : list));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!visitorId) {
      toast.error("ویزیتور را انتخاب کنید");
      return;
    }
    const valid = items.filter((it) => it.productName.trim());
    if (valid.length === 0) {
      toast.error("حداقل یک قلم کالا وارد کنید");
      return;
    }
    // بعد از اولین لمس تا پایان درخواست، ثبت دوباره ممکن نیست
    if (submitRef.current) return;
    submitRef.current = true;
    setBusy(true);
    let res: Awaited<ReturnType<typeof createOrderAction>>;
    try {
      res = await createOrderAction({
        clientKey: clientKeyRef.current || undefined,
        visitorId,
        note: note || undefined,
        settlementType,
        settlementDays: toNum(settlementDays) || 0,
        items: valid.map((it) => ({
          productName: it.productName,
          qty: toNum(it.qty) || 1,
          unitPrice: toNum(it.unitPrice) || 0,
          discountPct: toNum(it.discountPct) || 0,
        })),
      });
    } finally {
      submitRef.current = false;
      setBusy(false);
    }
    if (res.ok) {
      // ثبت چک دستی همراه سفارش (در صورت پر شدن فیلدها)
      if (res.id && toNum(chequeAmount) > 0 && chequeDue) {
        const v = data?.visitors.find((x) => x.id === visitorId);
        await addChequeAction({
          visitorName: v?.name ?? "—",
          amount: toNum(chequeAmount),
          dueDate: chequeDue,
          orderId: res.id,
        });
      }
      toast.success("سفارش ثبت شد");
      setNewOpen(false);
      setVisitorId("");
      setNote("");
      setSettlementType("cash");
      setSettlementDays("");
      setChequeOpen(false);
      setChequeAmount("");
      setChequeDue("");
      setItems([{ key: 1, productName: "", qty: "1", unitPrice: "", discountPct: "0" }]);
      load();
    } else toast.error(res.error ?? "خطا در ثبت سفارش");
  }

  async function setStatus(o: Order, status: string) {
    const res = await setOrderStatusAction(o.id, status);
    if (res.ok) load();
    else toast.error(res.error ?? "خطا");
  }

  async function remove(o: Order) {
    if (!confirm("این سفارش به سطل بازیافت منتقل شود؟ بعداً می‌توانید آن را بازگردانی کنید.")) return;
    const res = await deleteOrderAction(o.id);
    if (res.ok) {
      toast.success("به سطل بازیافت منتقل شد");
      setDetail(null);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function restore(o: Order) {
    const res = await restoreOrderAction(o.id);
    if (res.ok) {
      toast.success("سفارش بازگردانی شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function purge(o: Order) {
    if (!confirm("این سفارش برای همیشه حذف شود؟ این کار قابل بازگشت نیست.")) return;
    const res = await purgeOrderAction(o.id);
    if (res.ok) {
      toast.success("برای همیشه حذف شد");
      load();
    } else toast.error(res.error ?? "خطا");
  }

  /** تکرار سفارش: فرم را با همان ویزیتور و اقلام از پیش پر میکند */
  function repeatOrder(o: Order) {
    setVisitorId(o.visitorId);
    setNote("");
    setChequeOpen(false);
    setChequeAmount("");
    setChequeDue("");
    setItems(
      (o.items ?? []).map((it, i) => ({
        key: i + 1,
        productName: it.productName,
        qty: String(it.qty),
        unitPrice: String(it.unitPrice),
        discountPct: String(it.discountPct),
      }))
    );
    setDetail(null);
    setNewOpen(true);
  }

  async function doCopy(o: Order) {
    const ok = await copyText(orderPlainText(o, data?.pharmacyName ?? undefined));
    toast[ok ? "success" : "error"](ok ? "متن سفارش کپی شد" : "کپی ناموفق بود");
  }

  async function doPdf(o: Order) {
    try {
      toast.loading("در حال ساخت PDF…");
      await exportOrderPdf(o, data?.pharmacyName ?? undefined);
      toast.success("فایل PDF دانلود شد");
    } catch {
      toast.error("ساخت PDF ناموفق بود");
    }
  }

  async function doExcel(o: Order) {
    try {
      await exportOrderExcel(o);
      toast.success("فایل Excel دانلود شد");
    } catch {
      toast.error("ساخت Excel ناموفق بود");
    }
  }

  async function doShare(o: Order) {
    const text = orderPlainText(o, data?.pharmacyName ?? undefined);
    if (navigator.share) {
      try {
        await navigator.share({ text, title: "سفارش" });
        return;
      } catch {
        /* کاربر منصرف شد یا مرورگر رد کرد؛ به کپی برمی‌گردیم */
      }
    }
    const ok = await copyText(text);
    toast[ok ? "success" : "error"](
      ok ? "اشتراک‌گذاری مستقیم در دسترس نبود — متن کپی شد" : "کپی ناموفق بود"
    );
  }

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="سفارش فوری"
        subtitle="فقط برای مواقع ضروری — وقتی ویزیتور در دسترس نیست"
        action={
          <AddButton onClick={() => setNewOpen(true)}>سفارش جدید</AddButton>
        }
      />

      <SubscriptionBanner profile={data?.profile ?? null} trialDays={TRIAL_DAYS} compact role={data?.role} />

      {error && (
        <p className="rounded-xl px-3 py-2 text-xs font-medium" style={{ background: "var(--warning-soft)", color: "var(--warning-ink)" }}>
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      {ordersWithItems.length === 0 ? (
        <EmptyState title="سفارشی ثبت نشده" desc="اولین سفارش را از دکمه «سفارش جدید» ثبت کنید" />
      ) : (
        <div className="space-y-2.5">
          {ordersWithItems.map((o) => {
            const total = orderTotal(o);
            const sb = STATUS_BADGE[o.status];
            return (
              <button
                key={o.id}
                onClick={() => setDetail(o)}
                className="card w-full p-4 text-right transition active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-[color:var(--ink)]">
                        {o.visitorName ?? "ویزیتور"}
                      </span>
                      {o.visitorCompany && <Badge color="blue">{o.visitorCompany}</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-[color:var(--ink-soft)]">
                      {o.orderNo ? (
                        <span className="tnum font-bold text-[color:var(--primary-dark)]">
                          سفارش {faNum(o.orderNo)}
                        </span>
                      ) : null}
                      <span>{faDateTime(o.createdAt)}</span>
                      <span>{faNum(o.items?.length ?? 0)} قلم</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge color={sb?.color ?? "slate"}>{sb?.label ?? o.status}</Badge>
                    <span className="tnum text-sm font-bold text-[color:var(--primary-dark)]">{toman(total)}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        repeatOrder(o);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          repeatOrder(o);
                        }
                      }}
                      className="rounded-full bg-[color:var(--primary-soft)] px-2.5 py-1 text-[10px] font-bold text-[color:var(--primary-dark)] transition hover:bg-[color:var(--primary-soft)]"
                    >
                      ↻ تکرار سفارش
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---------- سطل بازیافت ---------- */}
      <section className="space-y-2.5">
        <button
          onClick={() => setTrashOpen((v) => !v)}
          aria-expanded={trashOpen}
          className="flex min-h-11 w-full items-center justify-between rounded-2xl px-1 text-sm font-bold text-[color:var(--ink-soft)]"
        >
          <span>سطل بازیافت ({faNum(trashWithItems.length)})</span>
          <svg
            viewBox="0 0 24 24"
            className={`size-4 transition ${trashOpen ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        {trashOpen &&
          (trashWithItems.length === 0 ? (
            <EmptyState title="سطل بازیافت خالی است" />
          ) : (
            trashWithItems.map((o) => (
              <div key={o.id} className="card space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-[color:var(--ink)]">
                      {o.visitorName ?? "ویزیتور"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-[color:var(--ink-soft)]">
                      {o.orderNo ? <span className="tnum font-bold">سفارش {faNum(o.orderNo)}</span> : null}
                      <span>{faNum(o.items?.length ?? 0)} قلم</span>
                      {o.deletedAt && <span>حذف: {faDateTime(o.deletedAt)}</span>}
                    </div>
                  </div>
                  <span className="tnum shrink-0 text-sm font-bold text-[color:var(--ink)]">
                    {toman(orderTotal(o))}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" className="flex-1 text-xs" onClick={() => restore(o)}>
                    بازگردانی
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1 text-xs text-[color:var(--danger-ink)]"
                    onClick={() => purge(o)}
                  >
                    حذف نهایی
                  </Button>
                </div>
              </div>
            ))
          ))}
      </section>

      {/* ---------- Create ---------- */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="سفارش جدید">
        <form onSubmit={create} className="space-y-3">
          {qnText && (
            <div className="rounded-xl border border-[color:var(--primary)] bg-[color:var(--primary-soft)]/60 px-3 py-2 text-[11px] leading-5 text-[color:var(--primary-dark)]">
              از یادداشت: <span className="font-medium">{qnText}</span>
            </div>
          )}
          <Field label="ویزیتور">
            <Select value={visitorId} onChange={(e) => setVisitorId(e.target.value)} required>
              <option value="">انتخاب کنید…</option>
              {(data?.visitors ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.company ? ` — ${v.company}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <label className="field-label">اقلام سفارش</label>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={it.key} className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--line)]/50 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-center text-[11px] text-[color:var(--ink-soft)]">{faNum(idx + 1)}</span>
                    <Input
                      list="order-products"
                      placeholder="نام کالا"
                      value={it.productName}
                      onChange={(e) => updateItem(it.key, { productName: e.target.value })}
                      className="flex-1 px-2.5 py-2 text-xs"
                    />
                    <button type="button" onClick={() => removeItem(it.key)} className="text-xs text-[color:var(--danger-ink)]">
                                          </button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="تعداد"
                      value={it.qty}
                      onChange={(e) => updateItem(it.key, { qty: e.target.value })}
                      className="px-2.5 py-2 text-xs"
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="قیمت واحد (تومان)"
                      value={it.unitPrice}
                      onChange={(e) => updateItem(it.key, { unitPrice: e.target.value })}
                      className="px-2.5 py-2 text-xs"
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="٪ تخفیف"
                      value={it.discountPct}
                      onChange={(e) => updateItem(it.key, { discountPct: e.target.value })}
                      className="px-2.5 py-2 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
            <datalist id="order-products">
              {(data?.products ?? []).map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <Button type="button" variant="secondary" onClick={addItem} className="mt-2 w-full text-xs">
              + افزودن قلم
            </Button>
          </div>

          <Field label="توضیحات (اختیاری)">
            <Textarea
              placeholder="توضیحات سفارش…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-14"
            />
          </Field>

          {/* نحوه‌ی تسویه — مال کل فاکتور است، نه هر قلم جدا */}
          <Field label="نحوه‌ی تسویه">
            <div className="flex gap-2">
              <div className="flex flex-1 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--line)" }}>
                <button
                  type="button"
                  onClick={() => setSettlementType("cash")}
                  className="flex-1 py-2 text-xs font-bold transition"
                  style={
                    settlementType === "cash"
                      ? { background: "var(--primary)", color: "var(--on-primary)" }
                      : { color: "var(--ink-soft)" }
                  }
                >
                  نقدی
                </button>
                <button
                  type="button"
                  onClick={() => setSettlementType("cheque")}
                  className="flex-1 py-2 text-xs font-bold transition"
                  style={
                    settlementType === "cheque"
                      ? { background: "var(--primary)", color: "var(--on-primary)" }
                      : { color: "var(--ink-soft)" }
                  }
                >
                  چک
                </button>
              </div>
              <Input
                inputMode="numeric"
                placeholder="مثلاً ۶۰ روز"
                value={settlementDays}
                onChange={(e) => setSettlementDays(e.target.value)}
                className="w-28"
              />
            </div>
          </Field>

          {/* چک اختیاری این سفارش — همه دستی */}
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
            <button
              type="button"
              onClick={() => setChequeOpen((o) => !o)}
              className="flex w-full items-center justify-between text-xs font-bold"
              style={{ color: "var(--ink)" }}
            >
              ثبت یک برگه‌ی چک واقعی همین حالا (اختیاری)
              <span style={{ color: "var(--ink-soft)" }}>{chequeOpen ? "▲" : "▼"}</span>
            </button>
            {chequeOpen && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="مبلغ چک (تومان)">
                  <Input
                    inputMode="numeric"
                    placeholder="دستی"
                    value={chequeAmount}
                    onChange={(e) => setChequeAmount(e.target.value)}
                  />
                </Field>
                <Field label="تاریخ سررسید">
                  <JalaliDatePicker value={chequeDue} onChange={setChequeDue} />
                </Field>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: "var(--primary-soft)" }}>
            <span className="text-xs font-medium" style={{ color: "var(--primary-dark)" }}>جمع کل سفارش</span>
            <span className="tnum text-base font-bold" style={{ color: "var(--primary-dark)" }}>{toman(draftTotal)}</span>
          </div>

          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? "در حال ثبت…" : "ثبت سفارش"}
          </Button>
        </form>
      </Modal>

      {/* ---------- Detail ---------- */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={
          detail
            ? `${detail.orderNo ? `سفارش شماره ${faNum(detail.orderNo)}` : "سفارش"} — ${faDate(detail.createdAt)}`
            : ""
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-soft)]">
              <Badge color="blue">{detail.visitorName ?? "ویزیتور"}</Badge>
              {detail.visitorCompany && <Badge color="slate">{detail.visitorCompany}</Badge>}
              <Badge color={STATUS_BADGE[detail.status]?.color ?? "slate"}>
                {STATUS_BADGE[detail.status]?.label ?? detail.status}
              </Badge>
            </div>

            <div className="space-y-2">
              {detail.items?.map((it, i) => (
                <div
                  key={it.id}
                  className="rounded-2xl border border-[color:var(--line)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-medium text-[color:var(--ink)]">
                      {faNum(i + 1)}. {it.productName}
                      {it.discountPct > 0 && (
                        <span className="ms-1 text-[11px] text-[color:var(--danger-ink)]">
                          (−{faNum(it.discountPct)}٪)
                        </span>
                      )}
                    </div>
                    <div className="tnum shrink-0 text-sm font-bold text-[color:var(--ink)]">
                      {toman(Math.round(it.qty * it.unitPrice * (1 - it.discountPct / 100)))}
                    </div>
                  </div>
                  <div className="tnum mt-1 text-[11px] text-[color:var(--ink-soft)]">
                    {faNum(it.qty)} عدد × {toman(it.unitPrice)}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 font-bold text-[color:var(--primary-dark)]">
                <span>جمع کل</span>
                <span className="tnum">{toman(orderTotal(detail))}</span>
              </div>
            </div>

            {detail.note && (
              <p className="rounded-xl bg-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--ink-soft)]">{detail.note}</p>
            )}

            <div>
              <p className="mb-2 text-[11px] font-medium text-[color:var(--ink-soft)]">وضعیت سفارش:</p>
              <div className="flex gap-2">
                {(["registered", "delivered", "cancelled"] as OrderStatusKey[]).map((s) => (
                  <Button
                    key={s}
                    variant={detail.status === s ? "primary" : "secondary"}
                    className="flex-1 px-2 py-2 text-xs"
                    onClick={() => setStatus(detail, s)}
                  >
                    {ORDER_STATUS[s]}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium text-[color:var(--ink-soft)]">ارسال سفارش:</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" className="text-xs" onClick={() => doCopy(detail)}>
                  کپی متن کامل
                </Button>
                <Button variant="secondary" className="text-xs" onClick={() => doPdf(detail)}>
                  ساخت PDF
                </Button>
                <Button variant="secondary" className="text-xs" onClick={() => doShare(detail)}>
                  اشتراک‌گذاری مستقیم
                </Button>
                <Button variant="secondary" className="text-xs" onClick={() => doExcel(detail)}>
                  خروجی Excel
                </Button>
              </div>
            </div>

            <div className="border-t border-[color:var(--line)] pt-3">
              <Button variant="ghost" className="text-xs text-[color:var(--danger-ink)]" onClick={() => remove(detail)}>
                حذف سفارش
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
