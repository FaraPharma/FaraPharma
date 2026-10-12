"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal, Field, Input, Select, Textarea, Button } from "@/components/ui";
import { setConditionAction } from "@/actions/visitors";
import { toNum, faNum } from "@/lib/format";
import type { Product, Visitor, Condition } from "@/lib/types";

export function ConditionForm({
  open,
  onClose,
  onSaved,
  products,
  visitors,
  fixedProductId,
  fixedVisitorId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  products?: Product[];
  visitors?: Visitor[];
  fixedProductId?: string;
  fixedVisitorId?: string;
  initial?: Condition | null;
}) {
  const [visitorId, setVisitorId] = useState("");
  const [productId, setProductId] = useState("");
  const [stock, setStock] = useState("in");
  const [cashPct, setCashPct] = useState("");
  const [checkDays, setCheckDays] = useState("");
  const [offer, setOffer] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVisitorId(fixedVisitorId ?? initial?.visitorId ?? "");
    setProductId(fixedProductId ?? initial?.productId ?? "");
    setStock(initial?.stock ?? "in");
    setCashPct(initial?.cashDiscountPct ? String(initial.cashDiscountPct) : "");
    setCheckDays(initial?.checkDays ? String(initial.checkDays) : "");
    setOffer(initial?.offer ?? "");
    setValidUntil(initial?.validUntil ?? "");
    setPrice(initial?.price ? String(initial.price) : "");
  }, [open, fixedVisitorId, fixedProductId, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!visitorId || !productId) {
      toast.error("ویزیتور و کالا را انتخاب کنید");
      return;
    }
    setBusy(true);
    const res = await setConditionAction({
      visitorId,
      productId,
      stock,
      cashDiscountPct: toNum(cashPct),
      checkDays: toNum(checkDays),
      offer,
      validUntil: validUntil || undefined,
      price: toNum(price) > 0 ? toNum(price) : undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("شرایط ذخیره شد");
      onSaved();
      onClose();
    } else {
      toast.error(res.error ?? "خطا در ذخیره");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="شرایط خرید">
      <form onSubmit={submit} className="space-y-3">
        {fixedVisitorId ? (
          <input type="hidden" value={visitorId} />
        ) : (
          <Field label="ویزیتور">
            <Select value={visitorId} onChange={(e) => setVisitorId(e.target.value)} required>
              <option value="">انتخاب کنید…</option>
              {(visitors ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.company ? ` — ${v.company}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {fixedProductId ? (
          <input type="hidden" value={productId} />
        ) : (
          <Field label="کالا">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">انتخاب کنید…</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.code ? ` (${p.code})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Field label="موجودی">
            <Select value={stock} onChange={(e) => setStock(e.target.value)}>
              <option value="in">دارد</option>
              <option value="low">کم</option>
              <option value="out">ندارد</option>
            </Select>
          </Field>
          <Field label="٪ نقدی">
            <Input
              inputMode="numeric"
              placeholder="مثلاً ۵"
              value={cashPct}
              onChange={(e) => setCashPct(e.target.value)}
            />
          </Field>
          <Field label="چک (روز)">
            <Input
              inputMode="numeric"
              placeholder="مثلاً ۳۰"
              value={checkDays}
              onChange={(e) => setCheckDays(e.target.value)}
            />
          </Field>
        </div>

        <Field label="قیمت لیست (تومان — اختیاری)">
          <Input
            inputMode="numeric"
            placeholder="مثلاً ۲۴۵۰۰۰"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>

        <Field label="آفر / شرایط ویژه (اختیاری)">
          <Input
            placeholder="مثلاً: با خرید ۱۰ عدد، ۱ عدد هدیه"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
          />
        </Field>
        <Field label="اعتبار شرایط تا تاریخ (اختیاری)">
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-[color:var(--ink-soft)]">
            پیش‌نمایش: نقد {faNum(toNum(cashPct))}٪ · چک {faNum(toNum(checkDays))} روز
          </p>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? "در حال ذخیره…" : "ذخیره شرایط"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
