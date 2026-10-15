"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useOfflineData } from "@/hooks/useOfflineData";
import { OfflineBadge } from "@/components/offline-badge";
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
  createRequestAction,
  addResponsesAction,
  toggleRequestAction,
  deleteRequestAction,
} from "@/actions/priceRequests";
import { createOrderAction } from "@/actions/orders";
import {
  buildRequestText,
  whatsappUrl,
  telegramUrl,
  baleUrl,
  rubikaUrl,
} from "@/lib/domain";
import { copyText } from "@/lib/export";
import { cn, faDate, faDateTime, faNum, toNum, toman } from "@/lib/format";
import type { Product, Visitor, PriceRequest, PriceResponse } from "@/lib/types";

interface PriceData {
  requests: PriceRequest[];
  items: Array<{ requestId: string; productId: string; productName: string }>;
  responses: PriceResponse[];
  products: Product[];
  visitors: Visitor[];
}

const STOCK_LABEL: Record<string, string> = { in: "دارد", low: "کم", out: "ندارد" };

/** state of one (visitor × product) response row inside the form */
interface RespRow {
  productId: string;
  productName: string;
  price: string;
  stock: string;
  checkDays: string;
  cashPct: string;
  offer: string;
}

function emptyRows(
  products: Array<{ productId: string; productName: string }>,
  existing: PriceResponse[]
): RespRow[] {
  return products.map((p) => {
    const ex = existing.find((r) => r.productId === p.productId);
    return {
      productId: p.productId,
      productName: p.productName,
      price: ex?.price ? String(ex.price) : "",
      stock: ex?.stock ?? "in",
      checkDays: ex?.checkDays ? String(ex.checkDays) : "",
      cashPct: ex?.cashDiscountPct ? String(ex.cashDiscountPct) : "",
      offer: ex?.offer ?? "",
    };
  });
}

export function PriceRequestsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data, error, loading, stale, savedAt, reload } =
    useOfflineData<PriceData>("/api/price-requests");
  const load = reload;
  const [newOpen, setNewOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickQ, setPickQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<PriceRequest | null>(null);
  const [detail, setDetail] = useState<PriceRequest | null>(null);
  // response form: one visitor × all request products
  const [respForm, setRespForm] = useState<{
    requestId: string;
    visitorId: string;
    rows: RespRow[];
  } | null>(null);

  // هنگام بارگذاری مجدد داده‌ها، درخواست‌های باز را تازه نگه می‌دارد
  useEffect(() => {
    setShare((s) => (s && data ? data.requests.find((r) => r.id === s.id) ?? s : s));
    setDetail((d) => (d && data ? data.requests.find((r) => r.id === d.id) ?? d : d));
  }, [data]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setPicked(new Set());
      setPickQ("");
      setNote("");
      setNewOpen(true);
      const pid = searchParams.get("product");
      if (pid) setPicked(new Set([pid]));
    }
  }, [searchParams]);

  // باز کردن مستقیم یک درخواست ساختهشده (مثلاً از صفحه کسریها با ?open=)
  const [consumedOpen, setConsumedOpen] = useState<string | null>(null);
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || !data || consumedOpen === openId) return;
    const r = data.requests.find((x) => x.id === openId);
    if (r) {
      setDetail(r);
      setConsumedOpen(openId);
      router.replace("/price-requests");
    }
  }, [searchParams, data, consumedOpen, router]);

  const productNames = useMemo(() => {
    if (!data) return {};
    const map: Record<string, string> = {};
    for (const it of data.items)
      map[it.requestId] = (map[it.requestId] ?? "").concat(it.productName, "، ");
    return map;
  }, [data]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (picked.size === 0) {
      toast.error("حداقل یک کالا انتخاب کنید");
      return;
    }
    setBusy(true);
    const res = await createRequestAction({
      productIds: Array.from(picked),
      note: note || undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("درخواست قیمت ساخته شد");
      setNewOpen(false);
      const result = await load();
      const created = result?.data?.requests?.find((r) => r.id === res.id) ?? null;
      if (created) setShare(created);
    } else toast.error(res.error ?? "خطا");
  }

  function requestProducts(r: PriceRequest): string[] {
    if (!data) return [];
    return data.items.filter((it) => it.requestId === r.id).map((it) => it.productName);
  }

  function requestItems(r: PriceRequest) {
    if (!data) return [];
    return data.items.filter((it) => it.requestId === r.id);
  }

  function requestText(r: PriceRequest): string {
    return buildRequestText(requestProducts(r), r.note);
  }

  async function copy(text: string) {
    const ok = await copyText(text);
    toast[ok ? "success" : "error"](ok ? "کپی شد — آماده ارسال" : "کپی ناموفق بود");
  }

  /** opens the per-visitor response form prefilled with existing responses */
  function openRespForm(requestId: string, visitorId: string) {
    if (!data) return;
    const items = data.items.filter((it) => it.requestId === requestId);
    const existing = data.responses.filter(
      (r) => r.requestId === requestId && r.visitorId === visitorId
    );
    setRespForm({ requestId, visitorId, rows: emptyRows(items, existing) });
  }

  async function saveResponse(e: React.FormEvent) {
    e.preventDefault();
    if (!respForm) return;
    setBusy(true);
    const res = await addResponsesAction({
      requestId: respForm.requestId,
      visitorId: respForm.visitorId,
      responses: respForm.rows.map((row) => ({
        productId: row.productId,
        price: toNum(row.price) || undefined,
        stock: row.stock || undefined,
        checkDays: toNum(row.checkDays) || undefined,
        cashDiscountPct: toNum(row.cashPct) || undefined,
        offer: row.offer || undefined,
      })),
    });
    setBusy(false);
    if (res.ok) {
      toast.success("پاسخ‌ها ثبت شد");
      setRespForm(null);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  async function toggle(r: PriceRequest) {
    const res = await toggleRequestAction(r.id);
    if (res.ok) load();
    else toast.error(res.error ?? "خطا");
  }

  async function remove(r: PriceRequest) {
    if (!confirm("این درخواست قیمت و پاسخ‌هایش حذف شود؟")) return;
    const res = await deleteRequestAction(r.id);
    if (res.ok) {
      toast.success("حذف شد");
      setDetail(null);
      load();
    } else toast.error(res.error ?? "خطا");
  }

  /** ثبت سریع سفارش از پاسخ یک ویزیتور (همه کالاهای درخواست) */
  async function orderFrom(visitorId: string, responses: PriceResponse[]) {
    if (!detail) return;
    const items = requestItems(detail);
    if (items.length === 0) {
      toast.error("این درخواست کالایی ندارد");
      return;
    }
    setBusy(true);
    const res = await createOrderAction({
      visitorId,
      note: `ثبت از مقایسه قیمت (${faDate(detail.createdAt)})`,
      items: items.map((it) => {
        const r = responses.find((x) => x.productId === it.productId);
        return {
          productName: it.productName,
          qty: 1,
          unitPrice: r?.price ?? 0,
          discountPct: 0,
        };
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success("سفارش ثبت شد — برای خروجی به صفحه سفارش‌ها رفتید");
      router.push("/orders");
    } else toast.error(res.error ?? "خطا در ثبت سفارش");
  }

  // ---------- live comparison (visitor × product) ----------
  const detailItems = detail ? requestItems(detail) : [];
  const detailResponses = detail && data
    ? data.responses.filter((r) => r.requestId === detail.id)
    : [];
  const respondedVisitors = useMemo(() => {
    const ids = Array.from(new Set(detailResponses.map((r) => r.visitorId)));
    return ids
      .map((id) => data?.visitors.find((v) => v.id === id))
      .filter((v): v is Visitor => !!v);
  }, [detailResponses, data]);
  const pendingVisitors = detail && data
    ? data.visitors.filter(
        (v) => !detailResponses.some((r) => r.visitorId === v.id)
      )
    : [];
  // بهترین قیمت برای هر کالا (برای هایلایت ردیف‌ها)
  const minPriceByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of detailResponses) {
      if (r.price == null) continue;
      if (map[r.productId] === undefined || r.price < map[r.productId])
        map[r.productId] = r.price;
    }
    return map;
  }, [detailResponses]);

  const filteredProducts = useMemo(() => {
    if (!data) return [];
    const query = pickQ.trim();
    if (!query) return data.products;
    return data.products.filter(
      (p) => p.name.includes(query) || (p.code ?? "").includes(query)
    );
  }, [data, pickQ]);

  /** ویزیتورهایی که آیدی پیام‌رسان (تلگرام/بله/روبیکا) ثبت کرده‌اند */
  const messengerVisitors = useMemo(
    () => (data?.visitors ?? []).filter((v) => v.messengerUsername),
    [data]
  );

  if (loading && !data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="درخواست قیمت"
        subtitle="متن آماده برای ویزیتورها + جدول مقایسه زنده (ویزیتور × کالا)"
        action={
          <AddButton onClick={() => setNewOpen(true)}>درخواست جدید</AddButton>
        }
      />

      {error && (
        <p className="rounded-xl bg-[color:var(--warning-soft)] px-3 py-2 text-xs font-medium text-[color:var(--warning-ink)]">
          {error}
        </p>
      )}

      <OfflineBadge stale={stale} savedAt={savedAt} />

      {(data?.requests.length ?? 0) === 0 ? (
        <EmptyState
          title="درخواست قیمتی ثبت نشده"
          desc="درخواست بسازید، متنش را برای ویزیتورها بفرستید و پاسخ‌ها را مقایسه کنید"
        />
      ) : (
        <div className="space-y-2.5">
          {data?.requests.map((r) => {
            const count = data.responses.filter((x) => x.requestId === r.id).length;
            const total = data.items.filter((x) => x.requestId === r.id).length;
            return (
              <button
                key={r.id}
                onClick={() => setDetail(r)}
                className="card w-full p-4 text-right transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[color:var(--ink-soft)]">{faDateTime(r.createdAt)}</span>
                      <Badge color={r.status === "open" ? "teal" : "slate"}>
                        {r.status === "open" ? "باز" : "بسته"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[color:var(--ink)]">
                      {productNames[r.id] ?? ""}
                    </p>
                    <p className="mt-1 text-[11px] text-[color:var(--ink-soft)]">
                      {faNum(count)} پاسخ ({faNum(total)} کالا ×{" "}
                      {faNum(data.visitors.length)} ویزیتور)
                    </p>
                  </div>
                  <span className="shrink-0 text-[color:var(--ink-soft)]">‹</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---------- Create ---------- */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="درخواست قیمت جدید">
        <form onSubmit={create} className="space-y-3">
          <Field label="کالاهای موردنظر">
            <div className="rounded-xl border border-[color:var(--line)]">
              <div className="border-b border-[color:var(--line)] p-2">
                <input
                  className="w-full bg-transparent text-xs outline-none placeholder:text-[color:var(--ink-soft)]"
                  placeholder="جستجوی کالا…"
                  value={pickQ}
                  onChange={(e) => setPickQ(e.target.value)}
                />
              </div>
              <div className="max-h-56 overflow-y-auto p-2">
                {filteredProducts.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[color:var(--line)]"
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        setPicked(next);
                      }}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="flex-1">{p.name}</span>
                    {p.code && <span className="text-[10px] text-[color:var(--ink-soft)]" dir="ltr">{p.code}</span>}
                  </label>
                ))}
                {filteredProducts.length === 0 && (
                  <p className="p-3 text-center text-[11px] text-[color:var(--ink-soft)]">کالایی پیدا نشد</p>
                )}
              </div>
            </div>
          </Field>
          <p className="text-[11px] text-[color:var(--ink-soft)]">{faNum(picked.size)} کالا انتخاب شده</p>
          <Field label="توضیح اضافه در متن (اختیاری)">
            <Textarea
              placeholder="مثلاً: قیمت عمده با احتساب ارسال"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-16"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? "در حال ساخت…" : "ساخت درخواست و دریافت متن آماده"}
          </Button>
        </form>
      </Modal>

      {/* ---------- Share text ---------- */}
      <Modal open={!!share} onClose={() => setShare(null)} title="متن آماده برای ارسال">
        {share && (
          <div className="space-y-3">
            <pre className="whitespace-pre-wrap rounded-2xl bg-[color:var(--line)] p-4 text-xs leading-6 text-[color:var(--ink)]">
              {requestText(share)}
            </pre>
            <div className="flex gap-2">
              <Button onClick={() => copy(requestText(share))} className="flex-1">
                کپی متن
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShare(null);
                  setDetail(share);
                }}
              >
                ثبت پاسخ‌ها ←
              </Button>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium text-[color:var(--ink-soft)]">
                یا ارسال مستقیم به واتساپ ویزیتورها:
              </p>
              <div className="flex flex-wrap gap-2">
                {(data?.visitors ?? []).slice(0, 10).map((v) =>
                  v.phone ? (
                    <a
                      key={v.id}
                      href={whatsappUrl(v.phone, requestText(share))}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-[color:var(--primary)] bg-[color:var(--primary-soft)] px-3 py-1.5 text-xs font-medium text-[color:var(--primary-dark)]"
                    >
                      {v.name}
                    </a>
                  ) : null
                )}
                {(data?.visitors.filter((v) => v.phone).length ?? 0) === 0 && (
                  <p className="text-[11px] text-[color:var(--ink-soft)]">
                    برای ویزیتورها تلفن ثبت نشده — متن را کپی و دستی ارسال کنید
                  </p>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium text-[color:var(--ink-soft)]">
                تلگرام / بله / روبیکا:
              </p>

              {/* راه همیشگی: کپی متن برای ارسال دستی */}
              <button
                onClick={() => copy(requestText(share))}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-2 text-xs font-medium text-[color:var(--ink)] transition active:scale-[0.98]"
              >
                کپی متن برای ارسال دستی
              </button>

              {/* ویزیتورهایی که آیدی پیام‌رسان دارند: لینک مستقیم چت + کپی */}
              {messengerVisitors.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {messengerVisitors.map((v) => (
                    <div
                      key={v.id}
                      className="rounded-xl border border-[color:var(--line)] p-2.5"
                    >
                      <div className="mb-1.5 text-xs font-bold text-[color:var(--ink)]">
                        {v.name}
                        {v.company ? ` — ${v.company}` : ""}
                        <span
                          className="ms-1 text-[10px] font-normal text-[color:var(--ink-soft)]"
                          dir="ltr"
                        >
                          @{v.messengerUsername}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <a
                          href={telegramUrl(v.messengerUsername)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-[color:var(--line)] bg-[color:var(--primary-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--primary-dark)] transition active:scale-95"
                        >
                          تلگرام
                        </a>
                        <a
                          href={baleUrl(v.messengerUsername)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-[color:var(--primary)] bg-[color:var(--primary-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--primary-dark)] transition active:scale-95"
                        >
                          🅱️ بله
                        </a>
                        <a
                          href={rubikaUrl(v.messengerUsername)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--danger-ink)] transition active:scale-95"
                        >
                          روبیکا
                        </a>
                        <button
                          onClick={() => copy(requestText(share))}
                          className="rounded-full border border-[color:var(--line)] bg-[color:var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--ink-soft)] transition active:scale-95"
                        >
                          کپی متن
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[10px] leading-4 text-[color:var(--ink-soft)]">
                  برای ارسال مستقیم در این پیام‌رسان‌ها، «آیدی تلگرام/بله/روبیکا»
                  ویزیتور را در پروفایل او ثبت کنید — تا آن زمان از کپی متن استفاده
                  کنید
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Detail / live comparison (visitor × product) ---------- */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `مقایسه پاسخ‌ها — ${faDate(detail.createdAt)}` : ""}
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy(requestText(detail))}>
                کپی متن درخواست
              </Button>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => toggle(detail)}>
                {detail.status === "open" ? "بستن درخواست" : "بازگشایی"}
              </Button>
              <Button variant="ghost" className="px-3 py-1.5 text-xs text-[color:var(--danger-ink)]" onClick={() => remove(detail)}>
                حذف
              </Button>
            </div>

            <div className="rounded-xl bg-[color:var(--line)] px-3 py-2 text-xs leading-6 text-[color:var(--ink-soft)]">
              <b>کالاها:</b> {detailItems.map((it) => it.productName).join(" · ")}
            </div>

            {detailResponses.length === 0 ? (
              <p className="rounded-xl bg-[color:var(--line)] px-3 py-2 text-center text-xs text-[color:var(--ink-soft)]">
                هنوز پاسخی ثبت نشده — از پایین پاسخ هر ویزیتور را برای تک‌تک کالاها ثبت کنید
              </p>
            ) : (
              <div className="space-y-3">
                {respondedVisitors.map((v) => {
                  const vResponses = detailResponses.filter((r) => r.visitorId === v.id);
                  const allAnswered = detailItems.every((it) =>
                    vResponses.some((r) => r.productId === it.productId && r.price != null)
                  );
                  const total = allAnswered
                    ? vResponses.reduce((sum, r) => sum + (r.price ?? 0), 0)
                    : null;
                  return (
                    <div key={v.id} className="overflow-hidden rounded-2xl border border-[color:var(--line)]">
                      <div className="flex items-center justify-between bg-[color:var(--line)] px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-[color:var(--ink)]">{v.name}</span>
                          {v.company && <span className="text-[11px] text-[color:var(--ink-soft)]">{v.company}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {total !== null && (
                            <Badge color="blue">جمع تقریبی: {toman(total)}</Badge>
                          )}
                          <Button
                            variant="secondary"
                            className="px-2 py-1 text-[11px]"
                            onClick={() => openRespForm(detail.id, v.id)}
                          >
                            ویرایش پاسخ‌ها
                          </Button>
                          <Button
                            variant="secondary"
                            className="px-2 py-1 text-[11px]"
                            disabled={busy}
                            onClick={() => orderFrom(v.id, vResponses)}
                          >
                            سفارش
                          </Button>
                        </div>
                      </div>
                      <div className="divide-y divide-[color:var(--line)]">
                        {detailItems.map((it) => {
                          const r = vResponses.find((x) => x.productId === it.productId);
                          const best = r && r.price != null && r.price === minPriceByProduct[it.productId];
                          return (
                            <div
                              key={it.productId}
                              className={cn(
                                "flex items-start justify-between gap-2 px-3 py-2",
                                best && "bg-[color:var(--primary-soft)]/70"
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-medium text-[color:var(--ink)]">
                                    {it.productName}
                                  </span>
                                  {best && <Badge color="green">بهترین قیمت این کالا</Badge>}
                                </div>
                                {r ? (
                                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                                    <Badge color="blue">{r.price != null ? toman(r.price) : "قیمت نامشخص"}</Badge>
                                    {r.stock && <Badge color="slate">{STOCK_LABEL[r.stock] ?? r.stock}</Badge>}
                                    {r.checkDays ? <Badge color="violet">چک {faNum(r.checkDays)} روز</Badge> : null}
                                    {r.cashDiscountPct ? <Badge color="teal">نقد {faNum(r.cashDiscountPct)}٪</Badge> : null}
                                    {r.offer && <span className="text-[color:var(--ink-soft)]">{r.offer}</span>}
                                  </div>
                                ) : (
                                  <p className="mt-1 text-[10px] text-[color:var(--ink-soft)]">پاسخی برای این کالا ثبت نشده</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pendingVisitors.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-medium text-[color:var(--ink-soft)]">
                  ویزیتورهایی که هنوز پاسخ نداده‌اند:
                </p>
                <div className="space-y-1.5">
                  {pendingVisitors.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-xl border border-dashed border-[color:var(--line)] px-3 py-2"
                    >
                      <span className="text-xs text-[color:var(--ink-soft)]">
                        {v.name}
                        {v.company ? ` — ${v.company}` : ""}
                      </span>
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-[11px]"
                        onClick={() => openRespForm(detail.id, v.id)}
                      >
                        ثبت پاسخ ({faNum(detailItems.length)} کالا)
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- Response form: one visitor × every request product ---------- */}
      <Modal
        open={!!respForm}
        onClose={() => setRespForm(null)}
        title={
          respForm
            ? `ثبت پاسخ: ${data?.visitors.find((v) => v.id === respForm.visitorId)?.name ?? ""}`
            : ""
        }
      >
        <form onSubmit={saveResponse} className="space-y-3">
          <p className="rounded-xl bg-[color:var(--line)] px-3 py-2 text-[11px] text-[color:var(--ink-soft)]">
            برای هر کالای درخواست یک پاسخ جداگانه ثبت می‌شود
            {respForm ? ` (${faNum(respForm.rows.length)} کالا)` : ""}
          </p>
          {respForm?.rows.map((row, idx) => (
            <div key={row.productId} className="rounded-2xl border border-[color:var(--line)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-[color:var(--ink)]">
                  {faNum(idx + 1)}. {row.productName}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="قیمت (تومان)">
                  <Input
                    inputMode="numeric"
                    placeholder="مثلاً ۲۴۵۰۰۰"
                    value={row.price}
                    onChange={(e) =>
                      setRespForm({
                        ...respForm,
                        rows: respForm.rows.map((x) =>
                          x.productId === row.productId ? { ...x, price: e.target.value } : x
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="موجودی">
                  <Select
                    value={row.stock}
                    onChange={(e) =>
                      setRespForm({
                        ...respForm,
                        rows: respForm.rows.map((x) =>
                          x.productId === row.productId ? { ...x, stock: e.target.value } : x
                        ),
                      })
                    }
                  >
                    <option value="in">دارد</option>
                    <option value="low">کم</option>
                    <option value="out">ندارد</option>
                  </Select>
                </Field>
                <Field label="چک (روز)">
                  <Input
                    inputMode="numeric"
                    placeholder="۰"
                    value={row.checkDays}
                    onChange={(e) =>
                      setRespForm({
                        ...respForm,
                        rows: respForm.rows.map((x) =>
                          x.productId === row.productId ? { ...x, checkDays: e.target.value } : x
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="٪ نقدی">
                  <Input
                    inputMode="numeric"
                    placeholder="۰"
                    value={row.cashPct}
                    onChange={(e) =>
                      setRespForm({
                        ...respForm,
                        rows: respForm.rows.map((x) =>
                          x.productId === row.productId ? { ...x, cashPct: e.target.value } : x
                        ),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="mt-2">
                <Field label="آفر / توضیح (اختیاری)">
                  <Input
                    placeholder="شرایط ویژه اعلام‌شده برای این کالا"
                    value={row.offer}
                    onChange={(e) =>
                      setRespForm({
                        ...respForm,
                        rows: respForm.rows.map((x) =>
                          x.productId === row.productId ? { ...x, offer: e.target.value } : x
                        ),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          ))}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "در حال ثبت…" : "ثبت همه پاسخ‌ها"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
